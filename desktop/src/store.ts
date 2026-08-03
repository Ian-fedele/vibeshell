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

export type PaneKind = "agent" | "terminal";

export interface Pane {
  id: string;
  workspaceId: string;
  kind: PaneKind;
  sessionId: string | null;
  /** Bound PTY id when kind === "terminal". */
  terminalId: string | null;
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
  /** Exit code from the last PTY exit (terminal panes). */
  terminalExitCode: number | null;
  /** Last terminal/engine error message (shown in the terminal chrome). */
  lastError: string | null;
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
  bySession: Record<string, string>; // sessionId|terminalId -> paneId
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
  | {
      type: "add_pane";
      paneId: string;
      workspaceId: string;
      title: string;
      kind?: PaneKind;
    }
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
  if (pane.kind === "terminal") return false;
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
    case "terminal_created": {
      const pane = state.panes.find((p) => p.id === event.requestId);
      if (!pane) return state;
      return updatePane(
        { ...state, bySession: { ...state.bySession, [event.terminalId]: pane.id } },
        pane.id,
        (p) => ({
          ...p,
          terminalId: event.terminalId,
          terminalExitCode: null,
          running: true,
          lastError: null,
        }),
      );
    }
    case "terminal_output":
      // Output is streamed out-of-band to xterm listeners (see useEngine).
      return state;
    case "terminal_exit": {
      const paneId = state.bySession[event.terminalId];
      const bySession = { ...state.bySession };
      delete bySession[event.terminalId];
      const next = { ...state, bySession };
      if (!paneId) return next;
      return updatePane(next, paneId, (p) => ({
        ...p,
        terminalId: null,
        running: false,
        terminalExitCode: event.exitCode,
        items: [
          ...p.items,
          {
            kind: "notice" as const,
            text:
              event.exitCode === null
                ? "shell exited"
                : `shell exited · code ${event.exitCode}`,
          },
        ],
      }));
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
        ? updatePane(next, paneId, (p) => ({
            ...p,
            sessionId: null,
            running: false,
            pending: null,
            canUndo: false,
            items: [...p.items, { kind: "notice", text: "session ended" }],
          }))
        : next;
    }
    case "sessions_snapshot": {
      // Reattach agent panes whose engine sessions are still alive; drop dead ids
      // so the client can create replacements. Transcript stays in the pane.
      const live = new Map(event.sessions.map((s) => [s.sessionId, s]));
      const bySession: Record<string, string> = { ...state.bySession };
      // Drop agent session bindings that aren't in this snapshot; keep terminal ids.
      for (const [id, paneId] of Object.entries(state.bySession)) {
        const pane = state.panes.find((p) => p.id === paneId);
        if (pane?.kind === "agent" && !live.has(id)) {
          delete bySession[id];
        }
      }
      const panes = state.panes.map((p) => {
        if (p.kind === "terminal") return p;
        if (p.sessionId && live.has(p.sessionId)) {
          bySession[p.sessionId] = p.id;
          const info = live.get(p.sessionId)!;
          return {
            ...p,
            canUndo: info.canUndo,
            branch: info.branch ?? p.branch,
            provider: info.provider || p.provider,
            model: info.model || p.model,
          };
        }
        if (p.sessionId) {
          const notice = "previous session ended — reconnecting…";
          const last = p.items[p.items.length - 1];
          const items =
            last?.kind === "notice" && last.text === notice
              ? p.items
              : [...p.items, { kind: "notice" as const, text: notice }];
          return {
            ...p,
            sessionId: null,
            running: false,
            pending: null,
            canUndo: false,
            items,
          };
        }
        return p;
      });
      const reattached = panes.some((p) => p.kind === "agent" && p.sessionId && live.has(p.sessionId));
      const withNotice =
        reattached && state.status === "open"
          ? panes.map((p) => {
              if (!p.sessionId) return p;
              const last = p.items[p.items.length - 1];
              if (last?.kind === "notice" && last.text === "disconnected — reconnecting…") {
                return {
                  ...p,
                  items: [...p.items.slice(0, -1), { kind: "notice" as const, text: "reconnected" }],
                };
              }
              if (last?.kind === "notice" && last.text === "reconnected") return p;
              return p;
            })
          : panes;
      return { ...state, panes: withNotice, bySession };
    }
    case "terminals_snapshot": {
      const live = new Set(event.terminals.map((t) => t.terminalId));
      const bySession = { ...state.bySession };
      for (const [id, paneId] of Object.entries(state.bySession)) {
        const pane = state.panes.find((p) => p.id === paneId);
        if (pane?.kind === "terminal" && !live.has(id)) {
          delete bySession[id];
        }
      }
      const panes = state.panes.map((p) => {
        if (p.kind !== "terminal") return p;
        if (p.terminalId && live.has(p.terminalId)) {
          bySession[p.terminalId] = p.id;
          return { ...p, running: true, terminalExitCode: null };
        }
        if (p.terminalId) {
          // Engine restarted — clear binding so UI can spawn a fresh shell.
          return {
            ...p,
            terminalId: null,
            running: false,
            terminalExitCode: null,
          };
        }
        return p;
      });
      return { ...state, panes, bySession };
    }
    case "error": {
      // create_* failures use requestId (= pane id); later errors use sessionId/terminalId.
      const paneId =
        (event.sessionId ? state.bySession[event.sessionId] : undefined) ??
        (event.requestId && state.panes.some((p) => p.id === event.requestId)
          ? event.requestId
          : undefined);
      if (!paneId) return state;
      return updatePane(state, paneId, (p) => ({
        ...p,
        running: false,
        lastError: event.message,
        items: [...p.items, { kind: "notice", text: `error: ${event.message}` }],
      }));
    }
    default:
      // Review/worktree events are handled outside the chat reducer.
      return state;
  }
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "status": {
      if (action.status === "closed") {
        // Keep sessionIds — the engine keeps sessions across socket drops.
        // The client reattaches via sessions_snapshot on the next open.
        return {
          ...state,
          status: "closed",
          panes: state.panes.map((p) => {
            if (!p.sessionId && !p.terminalId) return p;
            const last = p.items[p.items.length - 1];
            if (last?.kind === "notice" && last.text === "disconnected — reconnecting…") {
              return p;
            }
            // Terminal scrollback lives in xterm, not the feed — skip notice spam.
            if (p.kind === "terminal") return p;
            return {
              ...p,
              items: [...p.items, { kind: "notice", text: "disconnected — reconnecting…" }],
            };
          }),
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
            kind: action.kind ?? "agent",
            sessionId: null,
            terminalId: null,
            title: action.title,
            provider: state.provider,
            model: state.model,
            items: [],
            tokens: 0,
            pending: null,
            canUndo: false,
            branch: null,
            running: false,
            terminalExitCode: null,
            lastError: null,
          },
        ],
      };
    case "rebind_pane": {
      const pane = state.panes.find((p) => p.id === action.paneId);
      if (!pane || pane.kind === "terminal") return state;
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
      if (pane?.terminalId) delete bySession[pane.terminalId];
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
