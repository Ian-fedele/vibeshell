import { describe, expect, it } from "vitest";
import { reducer, initialState, DEFAULT_WORKSPACE_ID, type State } from "./store";

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

  it("select_workspace changes only the active workspace", () => {
    const state = run([
      { type: "add_workspace", workspaceId: "ws_2", name: "Workspace 2" },
      { type: "select_workspace", workspaceId: WS },
    ]);
    expect(state.activeWorkspaceId).toBe(WS);
    expect(state.workspaces).toHaveLength(2);
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
