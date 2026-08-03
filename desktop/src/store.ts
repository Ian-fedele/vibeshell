/**
 * Pure session store. One EngineClient connection multiplexes many sessions;
 * this reducer maps engine events (tagged with sessionId) onto panes (keyed by
 * a stable local id, also used as the create_session requestId). Kept pure so
 * the routing logic is easy to reason about and test.
 */
import type {
  AgentEvent,
  EngineEvent,
  PermissionDecision,
  ToolLink,
  ToolPreview,
} from "./protocol";

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  title?: string;
  preview: ToolPreview;
}

export type FeedItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | {
      kind: "tool";
      name: string;
      id?: string;
      detail?: string;
      status: "running" | "done" | "error";
      links?: ToolLink[];
    }
  | { kind: "result"; ok: boolean; durationMs: number; tokens: number; reason?: string }
  | { kind: "notice"; text: string };

/** Compact token display, e.g. 342 → "342", 1260 → "1.3k". */
export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export interface Pane {
  id: string;
  workspaceId: string;
  sessionId: string | null;
  title: string;
  /** Provider/model chosen when the pane was created (not the global picker). */
  provider: string;
  model: string;
  items: FeedItem[];
  tokens: number;
  pending: PermissionRequest | null;
  canUndo: boolean;
  branch: string | null;
  /** True while a turn is in flight (between user send and result). */
  running: boolean;
}

export interface Workspace {
  id: string;
  name: string;
}

export interface State {
  status: ConnectionStatus;
  provider: string;
  model: string;
  isolate: boolean;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  panes: Pane[];
  bySession: Record<string, string>; // sessionId -> paneId
}

export type Action =
  | { type: "status"; status: ConnectionStatus }
  | { type: "set_provider"; provider: string }
  | { type: "set_model"; model: string }
  | { type: "set_isolate"; isolate: boolean }
  | { type: "add_workspace"; workspaceId: string; name: string }
  | { type: "select_workspace"; workspaceId: string }
  | { type: "rename_workspace"; workspaceId: string; name: string }
  | { type: "delete_workspace"; workspaceId: string }
  | { type: "add_pane"; paneId: string; workspaceId: string; title: string }
  | {
      type: "rebind_pane";
      paneId: string;
      provider: string;
      model: string;
      notice?: string;
    }
  | { type: "close_pane"; paneId: string }
  | { type: "user_message"; paneId: string; text: string }
  | { type: "stop_turn"; paneId: string }
  | { type: "clear_permission"; paneId: string; decision: PermissionDecision }
  | { type: "add_notice"; paneId: string; text: string }
  | { type: "engine"; event: EngineEvent };

/** True when the pane has no real chat yet (safe to switch provider/model). */
export function isEmptyPane(pane: Pane): boolean {
  return !pane.items.some((i) => i.kind === "user" || i.kind === "assistant" || i.kind === "tool");
}

export const DEFAULT_WORKSPACE_ID = "ws_1";

export const PROVIDERS = ["claude", "grok"] as const;

export const MODELS_BY_PROVIDER: Record<string, readonly string[]> = {
  // API ids pass straight through to the Claude Agent SDK / Anthropic API.
  claude: ["claude-opus-5", "claude-fable-5", "claude-sonnet-5", "claude-haiku-4-5"],
  // Prefer IDs that work with both the xAI API and the grok CLI.
  grok: ["grok-4.5", "grok-4.3", "grok-build-0.1", "grok-4"],
};

export const DEFAULT_PROVIDER = "claude";
export const DEFAULT_MODEL = MODELS_BY_PROVIDER[DEFAULT_PROVIDER]![0]!;

export const initialState: State = {
  status: "connecting",
  provider: DEFAULT_PROVIDER,
  model: DEFAULT_MODEL,
  isolate: false,
  workspaces: [{ id: DEFAULT_WORKSPACE_ID, name: "Workspace 1" }],
  activeWorkspaceId: DEFAULT_WORKSPACE_ID,
  panes: [],
  bySession: {},
};

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

function mergeToolLinks(
  prev: ToolLink[] | undefined,
  next: ToolLink[] | undefined,
): ToolLink[] | undefined {
  if (!next?.length) return prev;
  if (!prev?.length) return next;
  const seen = new Set(prev.map((l) => l.url));
  const merged = [...prev];
  for (const l of next) {
    if (seen.has(l.url)) continue;
    seen.add(l.url);
    merged.push(l);
  }
  return merged;
}

/** Apply a tool start/update: merge by id, else last open tool with same name. */
export function applyToolEvent(
  items: FeedItem[],
  event: Extract<AgentEvent, { type: "tool" }>,
): FeedItem[] {
  let idx = -1;
  if (event.id) {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]!;
      if (it.kind === "tool" && it.id === event.id) {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0 && event.name && (event.status === "done" || event.status === "error" || event.links)) {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]!;
      if (it.kind === "tool" && it.name === event.name && it.status === "running") {
        idx = i;
        break;
      }
    }
  }

  if (idx >= 0) {
    const prev = items[idx] as Extract<FeedItem, { kind: "tool" }>;
    const updated: FeedItem = {
      kind: "tool",
      name: event.name ?? prev.name,
      id: event.id ?? prev.id,
      detail: event.detail ?? prev.detail,
      status: event.status ?? prev.status,
      links: mergeToolLinks(prev.links, event.links),
    };
    return [...items.slice(0, idx), updated, ...items.slice(idx + 1)];
  }

  return [
    ...items,
    {
      kind: "tool",
      name: event.name ?? "tool",
      id: event.id,
      detail: event.detail,
      status: event.status ?? "running",
      links: event.links,
    },
  ];
}

function applyAgentEvent(pane: Pane, event: AgentEvent): Pane {
  if (event.type === "text") return { ...pane, items: appendAssistant(pane.items, event.text) };
  if (event.type === "tool") return { ...pane, items: applyToolEvent(pane.items, event) };
  if (event.type === "permission_request") {
    return {
      ...pane,
      pending: {
        requestId: event.requestId,
        toolName: event.toolName,
        title: event.title,
        preview: event.preview,
      },
    };
  }
  // result ends the turn
  return {
    ...pane,
    running: false,
    pending: null,
    items: [...pane.items, { kind: "result", ...event }],
    // Assigned, not accumulated: event.tokens is the conversation's current
    // size, so each result supersedes the last. A failed turn leaves the
    // previous reading in place rather than reporting an empty context.
    tokens: event.ok ? event.tokens : pane.tokens,
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
        (p) => ({ ...p, sessionId: event.sessionId, branch: event.branch ?? p.branch }),
      );
    }
    case "agent_event": {
      const paneId = state.bySession[event.sessionId];
      if (!paneId) return state;
      return updatePane(state, paneId, (p) => applyAgentEvent(p, event.event));
    }
    case "checkpoint": {
      const paneId = state.bySession[event.sessionId];
      if (!paneId) return state;
      return updatePane(state, paneId, (p) => ({ ...p, canUndo: event.available }));
    }
    case "session_closed": {
      const paneId = state.bySession[event.sessionId];
      const bySession = { ...state.bySession };
      delete bySession[event.sessionId];
      const next = { ...state, bySession };
      return paneId
        ? updatePane(next, paneId, (p) => ({ ...p, sessionId: null, running: false }))
        : next;
    }
    case "error": {
      // create_session failures use requestId (= pane id); later errors use sessionId.
      const paneId =
        (event.sessionId ? state.bySession[event.sessionId] : undefined) ??
        (event.requestId && state.panes.some((p) => p.id === event.requestId)
          ? event.requestId
          : undefined);
      if (!paneId) return state;
      return updatePane(state, paneId, (p) => ({
        ...p,
        running: false,
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
              ? {
                  ...p,
                  sessionId: null,
                  pending: null,
                  canUndo: false,
                  running: false,
                  items: [...p.items, { kind: "notice", text: "disconnected — reconnecting…" }],
                }
              : p,
          ),
        };
      }
      return { ...state, status: action.status };
    }
    case "set_provider": {
      const model = MODELS_BY_PROVIDER[action.provider]?.[0] ?? state.model;
      return { ...state, provider: action.provider, model };
    }
    case "set_model":
      return { ...state, model: action.model };
    case "set_isolate":
      return { ...state, isolate: action.isolate };
    case "add_workspace":
      return {
        ...state,
        workspaces: [...state.workspaces, { id: action.workspaceId, name: action.name }],
        activeWorkspaceId: action.workspaceId,
      };
    case "select_workspace":
      return { ...state, activeWorkspaceId: action.workspaceId };
    case "rename_workspace":
      return {
        ...state,
        workspaces: state.workspaces.map((w) =>
          w.id === action.workspaceId ? { ...w, name: action.name } : w,
        ),
      };
    case "delete_workspace": {
      if (state.workspaces.length <= 1) return state; // keep at least one
      const workspaces = state.workspaces.filter((w) => w.id !== action.workspaceId);
      const removed = new Set(
        state.panes.filter((p) => p.workspaceId === action.workspaceId).map((p) => p.id),
      );
      const bySession = Object.fromEntries(
        Object.entries(state.bySession).filter(([, paneId]) => !removed.has(paneId)),
      );
      const activeWorkspaceId =
        state.activeWorkspaceId === action.workspaceId
          ? workspaces[0]!.id
          : state.activeWorkspaceId;
      return {
        ...state,
        workspaces,
        activeWorkspaceId,
        panes: state.panes.filter((p) => p.workspaceId !== action.workspaceId),
        bySession,
      };
    }
    case "add_pane":
      return {
        ...state,
        panes: [
          ...state.panes,
          {
            id: action.paneId,
            workspaceId: action.workspaceId,
            sessionId: null,
            title: action.title,
            provider: state.provider,
            model: state.model,
            items: [],
            tokens: 0,
            pending: null,
            canUndo: false,
            branch: null,
            running: false,
          },
        ],
      };
    case "rebind_pane": {
      const pane = state.panes.find((p) => p.id === action.paneId);
      if (!pane) return state;
      const bySession = { ...state.bySession };
      if (pane.sessionId) delete bySession[pane.sessionId];
      return updatePane({ ...state, bySession }, action.paneId, (p) => ({
        ...p,
        provider: action.provider,
        model: action.model,
        sessionId: null,
        pending: null,
        canUndo: false,
        running: false,
        tokens: 0,
        items: action.notice
          ? [...p.items, { kind: "notice" as const, text: action.notice }]
          : p.items,
      }));
    }
    case "close_pane": {
      const pane = state.panes.find((p) => p.id === action.paneId);
      const bySession = { ...state.bySession };
      if (pane?.sessionId) delete bySession[pane.sessionId];
      return { ...state, bySession, panes: state.panes.filter((p) => p.id !== action.paneId) };
    }
    case "user_message":
      return updatePane(state, action.paneId, (p) => ({
        ...p,
        running: true,
        items: [...p.items, { kind: "user", text: action.text }],
      }));
    case "stop_turn":
      return updatePane(state, action.paneId, (p) => ({
        ...p,
        running: false,
        items: [...p.items, { kind: "notice", text: "stopped" }],
      }));
    case "clear_permission":
      return updatePane(state, action.paneId, (p) => ({
        ...p,
        pending: null,
        items: [
          ...p.items,
          {
            kind: "notice",
            text: action.decision.type === "deny" ? "✗ denied" : "✓ approved",
          },
        ],
      }));
    case "add_notice":
      return updatePane(state, action.paneId, (p) => ({
        ...p,
        items: [...p.items, { kind: "notice", text: action.text }],
      }));
    case "engine":
      return applyEngineEvent(state, action.event);
  }
}
