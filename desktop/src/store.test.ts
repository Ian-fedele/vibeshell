import { describe, expect, it } from "vitest";
import {
  applyToolEvent,
  reducer,
  initialState,
  DEFAULT_WORKSPACE_ID,
  type FeedItem,
  type State,
} from "./store";

const WS = DEFAULT_WORKSPACE_ID;

/** Apply a sequence of actions from the initial state. */
function run(actions: Parameters<typeof reducer>[1][]): State {
  return actions.reduce(reducer, initialState);
}

describe("session store", () => {
  it("adds a pane with no session, then binds it on session_created", () => {
    const state = run([
      { type: "add_pane", paneId: "pane_1", workspaceId: WS, title: "session 1" },
      { type: "engine", event: { type: "session_created", requestId: "pane_1", sessionId: "sess_a" } },
    ]);
    expect(state.panes).toHaveLength(1);
    expect(state.panes[0]!.sessionId).toBe("sess_a");
    expect(state.panes[0]!.workspaceId).toBe(WS);
    expect(state.bySession).toEqual({ sess_a: "pane_1" });
  });

  it("marks a pane running on send and idle on result", () => {
    const running = run([
      { type: "add_pane", paneId: "pane_1", workspaceId: WS, title: "one" },
      {
        type: "engine",
        event: { type: "session_created", requestId: "pane_1", sessionId: "sess_a" },
      },
      { type: "user_message", paneId: "pane_1", text: "hi" },
    ]);
    expect(running.panes[0]!.running).toBe(true);

    const done = reducer(running, {
      type: "engine",
      event: {
        type: "agent_event",
        sessionId: "sess_a",
        event: { type: "result", ok: true, durationMs: 10, tokens: 100 },
      },
    });
    expect(done.panes[0]!.running).toBe(false);
  });

  it("stop_turn clears running and adds a notice", () => {
    const state = run([
      { type: "add_pane", paneId: "pane_1", workspaceId: WS, title: "one" },
      { type: "user_message", paneId: "pane_1", text: "go" },
      { type: "stop_turn", paneId: "pane_1" },
    ]);
    expect(state.panes[0]!.running).toBe(false);
    expect(state.panes[0]!.items.some((i) => i.kind === "notice" && i.text === "stopped")).toBe(
      true,
    );
  });

  it("merges tool results and links into the same feed row", () => {
    const started: FeedItem[] = applyToolEvent([], {
      type: "tool",
      name: "WebSearch",
      id: "tu_1",
      detail: "rust async",
      status: "running",
    });
    const done = applyToolEvent(started, {
      type: "tool",
      id: "tu_1",
      status: "done",
      links: [
        { title: "Tokio", url: "https://tokio.rs" },
        { url: "https://docs.rs/tokio" },
      ],
    });
    expect(done).toEqual([
      {
        kind: "tool",
        name: "WebSearch",
        id: "tu_1",
        detail: "rust async",
        status: "done",
        links: [
          { title: "Tokio", url: "https://tokio.rs" },
          { url: "https://docs.rs/tokio" },
        ],
      },
    ]);
  });

  it("routes agent events to the pane that owns the session", () => {
    const state = run([
      { type: "add_pane", paneId: "pane_1", workspaceId: WS, title: "one" },
      { type: "add_pane", paneId: "pane_2", workspaceId: WS, title: "two" },
      { type: "engine", event: { type: "session_created", requestId: "pane_1", sessionId: "sess_a" } },
      { type: "engine", event: { type: "session_created", requestId: "pane_2", sessionId: "sess_b" } },
      { type: "engine", event: { type: "agent_event", sessionId: "sess_b", event: { type: "text", text: "hi" } } },
    ]);
    expect(state.panes[0]!.items).toEqual([]);
    expect(state.panes[1]!.items).toEqual([{ kind: "assistant", text: "hi" }]);
  });

  it("accumulates streamed text and per-pane tokens", () => {
    const state = run([
      { type: "add_pane", paneId: "pane_1", workspaceId: WS, title: "one" },
      { type: "engine", event: { type: "session_created", requestId: "pane_1", sessionId: "sess_a" } },
      { type: "engine", event: { type: "agent_event", sessionId: "sess_a", event: { type: "text", text: "he" } } },
      { type: "engine", event: { type: "agent_event", sessionId: "sess_a", event: { type: "text", text: "llo" } } },
      {
        type: "engine",
        event: {
          type: "agent_event",
          sessionId: "sess_a",
          event: { type: "result", ok: true, durationMs: 1000, tokens: 1200 },
        },
      },
    ]);
    const pane = state.panes[0]!;
    expect(pane.items[0]).toEqual({ kind: "assistant", text: "hello" });
    expect(pane.tokens).toBe(1200);
  });

  it("replaces pane tokens each turn instead of summing them", () => {
    // result.tokens is conversation size, not turn spend. Summing would
    // re-count the cached prefix every turn — three turns of a small chat
    // reported millions of tokens.
    const result = (tokens: number) => ({
      type: "engine" as const,
      event: {
        type: "agent_event" as const,
        sessionId: "sess_a",
        event: { type: "result" as const, ok: true, durationMs: 1000, tokens },
      },
    });
    const state = run([
      { type: "add_pane", paneId: "pane_1", workspaceId: WS, title: "one" },
      { type: "engine", event: { type: "session_created", requestId: "pane_1", sessionId: "sess_a" } },
      result(12_000),
      result(12_400),
      result(12_950),
    ]);
    expect(state.panes[0]!.tokens).toBe(12_950);
  });

  it("keeps the last known size when a turn fails", () => {
    const state = run([
      { type: "add_pane", paneId: "pane_1", workspaceId: WS, title: "one" },
      { type: "engine", event: { type: "session_created", requestId: "pane_1", sessionId: "sess_a" } },
      {
        type: "engine",
        event: {
          type: "agent_event",
          sessionId: "sess_a",
          event: { type: "result", ok: true, durationMs: 1000, tokens: 12_000 },
        },
      },
      {
        type: "engine",
        event: {
          type: "agent_event",
          sessionId: "sess_a",
          event: { type: "result", ok: false, durationMs: 0, tokens: 0, reason: "error_max_turns" },
        },
      },
    ]);
    expect(state.panes[0]!.tokens).toBe(12_000);
  });

  it("on disconnect clears session ids and notes it, so reconnect can recreate", () => {
    const state = run([
      { type: "add_pane", paneId: "pane_1", workspaceId: WS, title: "one" },
      { type: "engine", event: { type: "session_created", requestId: "pane_1", sessionId: "sess_a" } },
      { type: "status", status: "closed" },
    ]);
    expect(state.status).toBe("closed");
    expect(state.panes[0]!.sessionId).toBeNull();
    expect(state.bySession).toEqual({});
    const items = state.panes[0]!.items;
    expect(items[items.length - 1]).toEqual({
      kind: "notice",
      text: "disconnected — reconnecting…",
    });
  });

  it("closing a pane removes it and its session mapping", () => {
    const state = run([
      { type: "add_pane", paneId: "pane_1", workspaceId: WS, title: "one" },
      { type: "engine", event: { type: "session_created", requestId: "pane_1", sessionId: "sess_a" } },
      { type: "close_pane", paneId: "pane_1" },
    ]);
    expect(state.panes).toHaveLength(0);
    expect(state.bySession).toEqual({});
  });

  it("adds a workspace, makes it active, and keeps panes grouped by workspace", () => {
    const state = run([
      { type: "add_pane", paneId: "pane_1", workspaceId: WS, title: "s1" },
      { type: "add_workspace", workspaceId: "ws_2", name: "Workspace 2" },
      { type: "add_pane", paneId: "pane_2", workspaceId: "ws_2", title: "s1" },
    ]);
    expect(state.workspaces.map((w) => w.id)).toEqual([WS, "ws_2"]);
    expect(state.activeWorkspaceId).toBe("ws_2");
    expect(state.panes.filter((p) => p.workspaceId === WS)).toHaveLength(1);
    expect(state.panes.filter((p) => p.workspaceId === "ws_2")).toHaveLength(1);
  });

  it("a checkpoint event toggles the pane's canUndo flag", () => {
    const state = run([
      { type: "add_pane", paneId: "pane_1", workspaceId: WS, title: "one" },
      { type: "engine", event: { type: "session_created", requestId: "pane_1", sessionId: "sess_a" } },
      { type: "engine", event: { type: "checkpoint", sessionId: "sess_a", available: true } },
    ]);
    expect(state.panes[0]!.canUndo).toBe(true);

    const cleared = reducer(state, {
      type: "engine",
      event: { type: "checkpoint", sessionId: "sess_a", available: false },
    });
    expect(cleared.panes[0]!.canUndo).toBe(false);
  });

  it("select_workspace changes only the active workspace", () => {
    const state = run([
      { type: "add_workspace", workspaceId: "ws_2", name: "Workspace 2" },
      { type: "select_workspace", workspaceId: WS },
    ]);
    expect(state.activeWorkspaceId).toBe(WS);
    expect(state.workspaces).toHaveLength(2);
  });

  it("renames a workspace", () => {
    const state = run([{ type: "rename_workspace", workspaceId: WS, name: "Renamed" }]);
    expect(state.workspaces[0]!.name).toBe("Renamed");
  });

  it("deletes a workspace with its panes and reassigns the active one", () => {
    const state = run([
      { type: "add_pane", paneId: "pane_1", workspaceId: WS, title: "s1" },
      { type: "engine", event: { type: "session_created", requestId: "pane_1", sessionId: "sess_a" } },
      { type: "add_workspace", workspaceId: "ws_2", name: "Workspace 2" },
      { type: "add_pane", paneId: "pane_2", workspaceId: "ws_2", title: "s1" },
      { type: "delete_workspace", workspaceId: WS },
    ]);
    expect(state.workspaces.map((w) => w.id)).toEqual(["ws_2"]);
    expect(state.activeWorkspaceId).toBe("ws_2");
    expect(state.panes.every((p) => p.workspaceId === "ws_2")).toBe(true);
    expect(state.bySession).toEqual({}); // sess_a's pane removed
  });

  it("won't delete the last workspace", () => {
    const state = run([{ type: "delete_workspace", workspaceId: WS }]);
    expect(state.workspaces).toHaveLength(1);
  });

  it("set_model updates the model for new sessions", () => {
    const state = run([{ type: "set_model", model: "claude-sonnet-5" }]);
    expect(state.model).toBe("claude-sonnet-5");
  });

  it("set_isolate toggles worktree isolation for new sessions", () => {
    expect(run([{ type: "set_isolate", isolate: true }]).isolate).toBe(true);
  });

  it("set_provider switches provider and resets model to that provider's default", () => {
    const state = run([{ type: "set_provider", provider: "grok" }]);
    expect(state.provider).toBe("grok");
    expect(state.model).toBe("grok-4.5");
  });

  it("snapshots provider/model onto new panes", () => {
    const state = run([
      { type: "set_provider", provider: "grok" },
      { type: "add_pane", paneId: "pane_1", workspaceId: WS, title: "g" },
    ]);
    expect(state.panes[0]!.provider).toBe("grok");
    expect(state.panes[0]!.model).toBe("grok-4.5");
  });

  it("rebind_pane switches provider/model and clears session binding", () => {
    const state = run([
      { type: "add_pane", paneId: "pane_1", workspaceId: WS, title: "one" },
      {
        type: "engine",
        event: { type: "session_created", requestId: "pane_1", sessionId: "sess_a" },
      },
      {
        type: "rebind_pane",
        paneId: "pane_1",
        provider: "grok",
        model: "grok-4.5",
        notice: "switched to grok · grok-4.5",
      },
    ]);
    const pane = state.panes[0]!;
    expect(pane.provider).toBe("grok");
    expect(pane.model).toBe("grok-4.5");
    expect(pane.sessionId).toBeNull();
    expect(state.bySession.sess_a).toBeUndefined();
    expect(pane.items).toContainEqual({
      kind: "notice",
      text: "switched to grok · grok-4.5",
    });
  });

  it("surfaces create_session errors via requestId (pane id)", () => {
    const state = run([
      { type: "add_pane", paneId: "pane_1", workspaceId: WS, title: "one" },
      {
        type: "engine",
        event: {
          type: "error",
          requestId: "pane_1",
          message: "Grok is not configured",
        },
      },
    ]);
    expect(state.panes[0]!.items).toEqual([
      { kind: "notice", text: "error: Grok is not configured" },
    ]);
  });

  it("records the worktree branch from session_created", () => {
    const state = run([
      { type: "add_pane", paneId: "pane_1", workspaceId: WS, title: "one" },
      {
        type: "engine",
        event: {
          type: "session_created",
          requestId: "pane_1",
          sessionId: "sess_a",
          branch: "vibeshell/sess_a",
        },
      },
    ]);
    expect(state.panes[0]!.branch).toBe("vibeshell/sess_a");
  });

  it("sets a pending approval on permission_request and clears it on decision", () => {
    const withRequest = run([
      { type: "add_pane", paneId: "pane_1", workspaceId: WS, title: "one" },
      { type: "engine", event: { type: "session_created", requestId: "pane_1", sessionId: "sess_a" } },
      {
        type: "engine",
        event: {
          type: "agent_event",
          sessionId: "sess_a",
          event: {
            type: "permission_request",
            requestId: "req1",
            toolName: "Bash",
            preview: { kind: "bash", command: "ls -la" },
          },
        },
      },
    ]);
    expect(withRequest.panes[0]!.pending).toEqual({
      requestId: "req1",
      toolName: "Bash",
      title: undefined,
      preview: { kind: "bash", command: "ls -la" },
    });

    const afterDeny = reducer(withRequest, {
      type: "clear_permission",
      paneId: "pane_1",
      decision: { type: "deny" },
    });
    expect(afterDeny.panes[0]!.pending).toBeNull();
    const items = afterDeny.panes[0]!.items;
    expect(items[items.length - 1]).toEqual({ kind: "notice", text: "✗ denied" });
  });
});
