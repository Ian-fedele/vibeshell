/**
 * Pure session store. One EngineClient connection multiplexes many sessions;
 * this reducer maps engine events (tagged with sessionId) onto panes (keyed by
 * a stable local id, also used as the create_session requestId). Kept pure so
 * the routing logic is easy to reason about and test.
 */
import type { AgentEvent, EngineEvent } from "./protocol";

export type ConnectionStatus = "connecting" | "open" | "closed";

export type FeedItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string }
  | { kind: "result"; ok: boolean; durationMs: number; costUsd: number; reason?: string }
  | { kind: "notice"; text: string };

export interface Pane {
  id: string;
  sessionId: string | null;
  title: string;
  items: FeedItem[];
  cost: number;
}

export interface State {
  status: ConnectionStatus;
  panes: Pane[];
  bySession: Record<string, string>; // sessionId -> paneId
}

export type Action =
  | { type: "status"; status: ConnectionStatus }
  | { type: "add_pane"; paneId: string; title: string }
  | { type: "close_pane"; paneId: string }
  | { type: "user_message"; paneId: string; text: string }
  | { type: "engine"; event: EngineEvent };

export const initialState: State = { status: "connecting", panes: [], bySession: {} };

function updatePane(state: State, paneId: string, fn: (p: Pane) => Pane): State {
  return { ...state, panes: state.panes.map((p) => (p.id === paneId ? fn(p) : p)) };
}

function appendAssistant(items: FeedItem[], text: string): FeedItem[] {
  const last = items[items.length - 1];
  if (last && last.kind === "assistant") {
    return [...items.slice(0, -1), { kind: "assistant", text: last.text + text }];
  }
  return [...items, { kind: "assistant", text }];
}

function applyAgentEvent(pane: Pane, event: AgentEvent): Pane {
  if (event.type === "text") return { ...pane, items: appendAssistant(pane.items, event.text) };
  if (event.type === "tool") return { ...pane, items: [...pane.items, { kind: "tool", name: event.name }] };
  return {
    ...pane,
    items: [...pane.items, { kind: "result", ...event }],
    cost: pane.cost + (event.ok ? event.costUsd : 0),
  };
}

function applyEngineEvent(state: State, event: EngineEvent): State {
  switch (event.type) {
    case "session_created": {
      const pane = state.panes.find((p) => p.id === event.requestId);
      if (!pane) return state;
      return updatePane(
        { ...state, bySession: { ...state.bySession, [event.sessionId]: pane.id } },
        pane.id,
        (p) => ({ ...p, sessionId: event.sessionId }),
      );
    }
    case "agent_event": {
      const paneId = state.bySession[event.sessionId];
      if (!paneId) return state;
      return updatePane(state, paneId, (p) => applyAgentEvent(p, event.event));
    }
    case "session_closed": {
      const paneId = state.bySession[event.sessionId];
      const bySession = { ...state.bySession };
      delete bySession[event.sessionId];
      const next = { ...state, bySession };
      return paneId ? updatePane(next, paneId, (p) => ({ ...p, sessionId: null })) : next;
    }
    case "error": {
      const paneId = event.sessionId ? state.bySession[event.sessionId] : undefined;
      if (!paneId) return state;
      return updatePane(state, paneId, (p) => ({
        ...p,
        items: [...p.items, { kind: "notice", text: `error: ${event.message}` }],
      }));
    }
  }
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "status": {
      if (action.status === "closed") {
        // Sessions are gone server-side; clear ids so reconnect recreates them.
        return {
          ...state,
          status: "closed",
          bySession: {},
          panes: state.panes.map((p) =>
            p.sessionId
              ? { ...p, sessionId: null, items: [...p.items, { kind: "notice", text: "disconnected — reconnecting…" }] }
              : p,
          ),
        };
      }
      return { ...state, status: action.status };
    }
    case "add_pane":
      return {
        ...state,
        panes: [...state.panes, { id: action.paneId, sessionId: null, title: action.title, items: [], cost: 0 }],
      };
    case "close_pane": {
      const pane = state.panes.find((p) => p.id === action.paneId);
      const bySession = { ...state.bySession };
      if (pane?.sessionId) delete bySession[pane.sessionId];
      return { ...state, bySession, panes: state.panes.filter((p) => p.id !== action.paneId) };
    }
    case "user_message":
      return updatePane(state, action.paneId, (p) => ({
        ...p,
        items: [...p.items, { kind: "user", text: action.text }],
      }));
    case "engine":
      return applyEngineEvent(state, action.event);
  }
}
