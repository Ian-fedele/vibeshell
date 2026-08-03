/**
 * Persist the UI shell (panes, workspaces, transcripts, session ids) so a
 * full page reload (Vite HMR, accidental refresh) can reattach to live engine
 * sessions instead of looking like a crash.
 */
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  DEFAULT_WORKSPACE_ID,
  type FeedItem,
  type Pane,
  type PaneKind,
  type State,
  type Workspace,
} from "./store";

export const STORAGE_KEY = "vibeshell.ui.v1";

/** Cap transcript length so localStorage stays under quota. */
const MAX_ITEMS_PER_PANE = 400;

export interface PersistedUi {
  v: 1;
  provider: string;
  model: string;
  isolate: boolean;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  panes: Pane[];
}

function trimItems(items: FeedItem[]): FeedItem[] {
  if (items.length <= MAX_ITEMS_PER_PANE) return items;
  return items.slice(items.length - MAX_ITEMS_PER_PANE);
}

export function toPersisted(state: State): PersistedUi {
  return {
    v: 1,
    provider: state.provider,
    model: state.model,
    isolate: state.isolate,
    workspaces: state.workspaces,
    activeWorkspaceId: state.activeWorkspaceId,
    panes: state.panes.map((p) => ({
      ...p,
      // Pending permission may still be valid server-side after reload.
      items: p.kind === "terminal" ? [] : trimItems(p.items),
    })),
  };
}

function asKind(v: unknown): PaneKind {
  return v === "terminal" ? "terminal" : "agent";
}

export function fromPersisted(raw: unknown): State | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<PersistedUi>;
  if (data.v !== 1) return null;
  if (!Array.isArray(data.workspaces) || data.workspaces.length === 0) return null;
  if (!Array.isArray(data.panes)) return null;

  const workspaces = data.workspaces.filter(
    (w): w is Workspace =>
      !!w && typeof w === "object" && typeof w.id === "string" && typeof w.name === "string",
  );
  if (workspaces.length === 0) return null;

  const panes: Pane[] = [];
  for (const p of data.panes) {
    if (!p || typeof p !== "object") continue;
    if (typeof p.id !== "string" || typeof p.workspaceId !== "string") continue;
    const kind = asKind((p as Pane).kind);
    panes.push({
      id: p.id,
      workspaceId: p.workspaceId,
      kind,
      sessionId: typeof p.sessionId === "string" ? p.sessionId : null,
      terminalId: typeof (p as Pane).terminalId === "string" ? (p as Pane).terminalId : null,
      title: typeof p.title === "string" ? p.title : kind === "terminal" ? "terminal" : "session",
      provider: typeof p.provider === "string" ? p.provider : DEFAULT_PROVIDER,
      model: typeof p.model === "string" ? p.model : DEFAULT_MODEL,
      items: kind === "terminal" ? [] : Array.isArray(p.items) ? (p.items as FeedItem[]) : [],
      tokens: typeof p.tokens === "number" ? p.tokens : 0,
      pending: kind === "terminal" ? null : (p.pending ?? null),
      canUndo: kind === "terminal" ? false : !!p.canUndo,
      branch: typeof p.branch === "string" ? p.branch : null,
      running: !!p.running,
      terminalExitCode:
        typeof (p as Pane).terminalExitCode === "number" ? (p as Pane).terminalExitCode : null,
      lastError: typeof (p as Pane).lastError === "string" ? (p as Pane).lastError : null,
    });
  }

  const activeWorkspaceId =
    typeof data.activeWorkspaceId === "string" &&
    workspaces.some((w) => w.id === data.activeWorkspaceId)
      ? data.activeWorkspaceId
      : (workspaces[0]?.id ?? DEFAULT_WORKSPACE_ID);

  const bySession: Record<string, string> = {};
  for (const p of panes) {
    if (p.sessionId) bySession[p.sessionId] = p.id;
    if (p.terminalId) bySession[p.terminalId] = p.id;
  }

  return {
    status: "connecting",
    provider: typeof data.provider === "string" ? data.provider : DEFAULT_PROVIDER,
    model: typeof data.model === "string" ? data.model : DEFAULT_MODEL,
    isolate: !!data.isolate,
    workspaces,
    activeWorkspaceId,
    panes,
    bySession,
  };
}

export function loadPersistedState(
  storage: Pick<Storage, "getItem"> | null = typeof localStorage !== "undefined"
    ? localStorage
    : null,
): State | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const state = fromPersisted(JSON.parse(raw));
    if (!state) return null;
    // A cold boot never inherits "running" — the previous process is gone.
    // Session ids are kept so we can reattach if the engine process survived.
    return {
      ...state,
      status: "connecting",
      panes: state.panes.map((p) => ({ ...p, running: false })),
    };
  } catch {
    return null;
  }
}

export function savePersistedState(
  state: State,
  storage: Pick<Storage, "setItem"> | null = typeof localStorage !== "undefined"
    ? localStorage
    : null,
): void {
  if (!storage) return;
  // Nothing useful yet — keep storage clean on first paint.
  if (state.panes.length === 0) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(toPersisted(state)));
  } catch {
    // Quota or private mode — ignore; reconnect still works without history.
  }
}

/** Bump id counters so new panes/workspaces don't collide with restored ones. */
export function restoreCounters(state: State): { paneCounter: number; workspaceCounter: number } {
  let paneCounter = 0;
  let workspaceCounter = 1;
  for (const p of state.panes) {
    const m = /^pane_(\d+)$/.exec(p.id);
    if (m) paneCounter = Math.max(paneCounter, Number(m[1]));
  }
  for (const w of state.workspaces) {
    const m = /^ws_(\d+)$/.exec(w.id);
    if (m) workspaceCounter = Math.max(workspaceCounter, Number(m[1]));
  }
  return { paneCounter, workspaceCounter };
}
