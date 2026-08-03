import { describe, expect, it } from "vitest";
import {
  fromPersisted,
  loadPersistedState,
  restoreCounters,
  toPersisted,
  type PersistedUi,
} from "./persist";
import { DEFAULT_WORKSPACE_ID, type State } from "./store";

function sampleState(): State {
  return {
    status: "open",
    provider: "claude",
    model: "claude-opus-5",
    isolate: false,
    workspaces: [
      { id: DEFAULT_WORKSPACE_ID, name: "Workspace 1" },
      { id: "ws_3", name: "Other" },
    ],
    activeWorkspaceId: "ws_3",
    panes: [
      {
        id: "pane_7",
        workspaceId: DEFAULT_WORKSPACE_ID,
        kind: "agent",
        sessionId: "sess_a",
        terminalId: null,
        title: "session 1",
        provider: "claude",
        model: "claude-opus-5",
        items: [
          { kind: "user", text: "hello" },
          { kind: "assistant", text: "hi" },
        ],
        tokens: 1200,
        pending: null,
        canUndo: true,
        branch: null,
        running: false,
        terminalExitCode: null,
        lastError: null,
      },
    ],
    bySession: { sess_a: "pane_7" },
  };
}

describe("persist", () => {
  it("round-trips pane transcripts and session ids", () => {
    const state = sampleState();
    const raw = toPersisted(state);
    const restored = fromPersisted(raw);
    expect(restored).not.toBeNull();
    expect(restored!.status).toBe("connecting");
    expect(restored!.panes[0]!.sessionId).toBe("sess_a");
    expect(restored!.panes[0]!.items).toEqual(state.panes[0]!.items);
    expect(restored!.bySession).toEqual({ sess_a: "pane_7" });
    expect(restored!.activeWorkspaceId).toBe("ws_3");
  });

  it("restoreCounters advances past saved ids", () => {
    const { paneCounter, workspaceCounter } = restoreCounters(sampleState());
    expect(paneCounter).toBe(7);
    expect(workspaceCounter).toBe(3);
  });

  it("rejects malformed payloads", () => {
    expect(fromPersisted(null)).toBeNull();
    expect(fromPersisted({ v: 2 })).toBeNull();
    expect(fromPersisted({ v: 1, workspaces: [], panes: [] } satisfies Partial<PersistedUi>)).toBeNull();
  });

  it("loadPersistedState clears running flags", () => {
    const storage = {
      getItem: () =>
        JSON.stringify({
          v: 1,
          provider: "claude",
          model: "claude-opus-5",
          isolate: false,
          workspaces: [{ id: DEFAULT_WORKSPACE_ID, name: "Workspace 1" }],
          activeWorkspaceId: DEFAULT_WORKSPACE_ID,
          panes: [
            {
              id: "pane_1",
              workspaceId: DEFAULT_WORKSPACE_ID,
              sessionId: "sess_a",
              title: "s",
              provider: "claude",
              model: "claude-opus-5",
              items: [{ kind: "user", text: "hi" }],
              tokens: 0,
              pending: null,
              canUndo: false,
              branch: null,
              running: true,
            },
          ],
        }),
    };
    const state = loadPersistedState(storage);
    expect(state!.panes[0]!.running).toBe(false);
    expect(state!.panes[0]!.sessionId).toBe("sess_a");
    expect(state!.panes[0]!.items[0]).toEqual({ kind: "user", text: "hi" });
  });
});

