import { describe, expect, it } from "vitest";
import { reducer, initialState, type State } from "./store";

/** Apply a sequence of actions from the initial state. */
function run(actions: Parameters<typeof reducer>[1][]): State {
  return actions.reduce(reducer, initialState);
}

describe("session store", () => {
  it("adds a pane with no session, then binds it on session_created", () => {
    const state = run([
      { type: "add_pane", paneId: "pane_1", title: "session 1" },
      { type: "engine", event: { type: "session_created", requestId: "pane_1", sessionId: "sess_a" } },
    ]);
    expect(state.panes).toHaveLength(1);
    expect(state.panes[0]!.sessionId).toBe("sess_a");
    expect(state.bySession).toEqual({ sess_a: "pane_1" });
  });

  it("routes agent events to the pane that owns the session", () => {
    const state = run([
      { type: "add_pane", paneId: "pane_1", title: "one" },
      { type: "add_pane", paneId: "pane_2", title: "two" },
      { type: "engine", event: { type: "session_created", requestId: "pane_1", sessionId: "sess_a" } },
      { type: "engine", event: { type: "session_created", requestId: "pane_2", sessionId: "sess_b" } },
      { type: "engine", event: { type: "agent_event", sessionId: "sess_b", event: { type: "text", text: "hi" } } },
    ]);
    expect(state.panes[0]!.items).toEqual([]);
    expect(state.panes[1]!.items).toEqual([{ kind: "assistant", text: "hi" }]);
  });

  it("accumulates streamed text and per-pane cost", () => {
    const state = run([
      { type: "add_pane", paneId: "pane_1", title: "one" },
      { type: "engine", event: { type: "session_created", requestId: "pane_1", sessionId: "sess_a" } },
      { type: "engine", event: { type: "agent_event", sessionId: "sess_a", event: { type: "text", text: "he" } } },
      { type: "engine", event: { type: "agent_event", sessionId: "sess_a", event: { type: "text", text: "llo" } } },
      {
        type: "engine",
        event: {
          type: "agent_event",
          sessionId: "sess_a",
          event: { type: "result", ok: true, durationMs: 1000, costUsd: 0.02 },
        },
      },
    ]);
    const pane = state.panes[0]!;
    expect(pane.items[0]).toEqual({ kind: "assistant", text: "hello" });
    expect(pane.cost).toBeCloseTo(0.02);
  });

  it("on disconnect clears session ids and notes it, so reconnect can recreate", () => {
    const state = run([
      { type: "add_pane", paneId: "pane_1", title: "one" },
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
      { type: "add_pane", paneId: "pane_1", title: "one" },
      { type: "engine", event: { type: "session_created", requestId: "pane_1", sessionId: "sess_a" } },
      { type: "close_pane", paneId: "pane_1" },
    ]);
    expect(state.panes).toHaveLength(0);
    expect(state.bySession).toEqual({});
  });
});
