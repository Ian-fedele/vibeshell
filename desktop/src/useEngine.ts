/**
 * Wires a single EngineClient to the session store and exposes pane actions.
 *
 * Reconnect model:
 * - Engine sessions outlive WebSocket drops (process-scoped SessionManager).
 * - UI state (panes + transcripts + session ids) is persisted to localStorage
 *   so a Vite full reload can reattach instead of wiping the window.
 * - On connect the engine pushes sessions_snapshot; we rebind live sessions
 *   and only create_session for panes that lost theirs.
 * - Terminal panes stream PTY bytes out-of-band (not via the reducer) so
 *   xterm stays smooth under high output.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { EngineClient } from "./engine";
import { loadPersistedState, restoreCounters, savePersistedState } from "./persist";
import { cwdForEngine } from "./projects";
import type {
  DiffFile,
  EngineEvent,
  HistoryTurn,
  PermissionDecision,
  WorktreeListItem,
} from "./protocol";
import {
  initialState,
  isEmptyPane,
  MODELS_BY_PROVIDER,
  reducer,
  type Action,
  type FeedItem,
  type Pane,
  type State,
} from "./store";
import { toastError, toastInfo, toastSuccess } from "./toasts";

let paneCounter = 0;
let workspaceCounter = 1; // Workspace 1 exists in initialState
const nextPaneId = (): string => `pane_${++paneCounter}`;
const nextWorkspaceId = (): string => `ws_${++workspaceCounter}`;

/** Extract user/assistant turns for agent rehydration (skip tools/notices). */
export function historyFromItems(items: FeedItem[]): HistoryTurn[] {
  const turns: HistoryTurn[] = [];
  for (const item of items) {
    if (item.kind === "user" && item.text.trim()) {
      turns.push({ role: "user", text: item.text });
    } else if (item.kind === "assistant" && item.text.trim()) {
      turns.push({ role: "assistant", text: item.text });
    }
  }
  return turns.slice(-40);
}

function hasConversation(pane: Pane): boolean {
  return pane.items.some((i) => i.kind === "user" || i.kind === "assistant");
}

function bootState(): State {
  const saved = loadPersistedState();
  if (!saved) return initialState;
  const counters = restoreCounters(saved);
  paneCounter = counters.paneCounter;
  workspaceCounter = counters.workspaceCounter;
  return saved;
}

type TerminalOutputListener = (data: string) => void;

export function useEngine() {
  const [state, dispatch] = useReducer(reducer, undefined, bootState);
  const stateRef = useRef<State>(state);
  stateRef.current = state;
  const clientRef = useRef<EngineClient | null>(null);
  /** True once we've handled the first sessions_snapshot for this page load. */
  const bootstrapped = useRef(false);
  /** Pane ids with an in-flight create_session/create_terminal (+ start time). */
  const pendingCreates = useRef(new Map<string, number>());
  /** session_created that arrived before the pane existed (StrictMode / race). */
  const orphanCreated = useRef(
    new Map<string, { sessionId: string; branch?: string }>(),
  );
  /** paneId → PTY output listeners (stable across terminal bind/restart). */
  const paneTerminalListeners = useRef(new Map<string, Set<TerminalOutputListener>>());
  /** Project folder for new sessions/terminals ("." = engine process cwd). */
  const projectCwdRef = useRef(".");
  const reqCounter = useRef(0);
  const nextReq = () => `req_${++reqCounter.current}`;

  const PENDING_TTL_MS = 4_000;

  // Session review (diff) panel state — not in the chat reducer.
  const [review, setReview] = useState<{
    open: boolean;
    sessionId: string | null;
    paneTitle: string;
    files: DiffFile[];
    loading: boolean;
    canRestore: boolean;
  }>({
    open: false,
    sessionId: null,
    paneTitle: "",
    files: [],
    loading: false,
    canRestore: false,
  });

  const [worktrees, setWorktrees] = useState<WorktreeListItem[]>([]);
  const [worktreesLoading, setWorktreesLoading] = useState(false);

  const setProjectCwd = useCallback((path: string) => {
    projectCwdRef.current = cwdForEngine(path);
  }, []);

  /** Dispatch and keep stateRef in lockstep (engine events arrive outside React). */
  const apply = useCallback((action: Action): State => {
    const next = reducer(stateRef.current, action);
    stateRef.current = next;
    dispatch(action);
    return next;
  }, []);

  const createSession = useCallback(
    (
      paneId: string,
      opts?: {
        provider?: string;
        model?: string;
        worktree?: boolean;
        /** When true, seed agent with pane transcript (post-restart recreate). */
        withHistory?: boolean;
        /** Bypass in-flight guard (manual retry / stale pending). */
        force?: boolean;
      },
    ) => {
      const now = Date.now();
      const pendingSince = pendingCreates.current.get(paneId);
      if (pendingSince !== undefined && !opts?.force) {
        if (now - pendingSince < PENDING_TTL_MS) return;
        pendingCreates.current.delete(paneId);
      }
      const pane = stateRef.current.panes.find((p) => p.id === paneId);
      if (pane?.kind === "terminal") return;
      if (pane?.sessionId) return;

      // Bind a session_created that arrived before the pane was in the store.
      const orphan = orphanCreated.current.get(paneId);
      if (orphan) {
        orphanCreated.current.delete(paneId);
        pendingCreates.current.delete(paneId);
        apply({
          type: "engine",
          event: {
            type: "session_created",
            requestId: paneId,
            sessionId: orphan.sessionId,
            branch: orphan.branch,
          },
        });
        return;
      }

      if (!clientRef.current) {
        toastInfo("Engine not ready", "Wait for connection, then retry");
        return;
      }

      const provider =
        opts?.provider ?? pane?.provider ?? stateRef.current.provider;
      const model = opts?.model ?? pane?.model ?? stateRef.current.model;
      const history =
        opts?.withHistory && pane
          ? historyFromItems(pane.items)
          : undefined;
      pendingCreates.current.set(paneId, now);
      clientRef.current.send({
        type: "create_session",
        requestId: paneId,
        provider,
        model,
        cwd: projectCwdRef.current,
        worktree: opts?.worktree ?? stateRef.current.isolate,
        ...(history && history.length > 0 ? { history } : {}),
      });
    },
    [apply],
  );

  const createTerminal = useCallback((paneId: string, cols = 80, rows = 24, force = false) => {
    const now = Date.now();
    const pendingSince = pendingCreates.current.get(paneId);
    if (pendingSince !== undefined && !force) {
      if (now - pendingSince < PENDING_TTL_MS) return;
      pendingCreates.current.delete(paneId);
    }
    const pane = stateRef.current.panes.find((p) => p.id === paneId);
    if (!pane || pane.kind !== "terminal") return;
    if (pane.terminalId) return;
    if (!clientRef.current) return;
    pendingCreates.current.set(paneId, now);
    clientRef.current.send({
      type: "create_terminal",
      requestId: paneId,
      cwd: projectCwdRef.current,
      cols,
      rows,
    });
  }, []);

  /** Create engine sessions/terminals for any pane that is not bound. */
  const ensureSessions = useCallback(
    (s: State, opts?: { withHistory?: boolean; force?: boolean }) => {
      for (const pane of s.panes) {
        if (pane.kind === "terminal") {
          if (!pane.terminalId) createTerminal(pane.id, 80, 24, opts?.force);
          continue;
        }
        if (!pane.sessionId) {
          createSession(pane.id, {
            provider: pane.provider,
            model: pane.model,
            withHistory: opts?.withHistory ?? hasConversation(pane),
            force: opts?.force,
          });
        }
      }
    },
    [createSession, createTerminal],
  );

  const emitTerminalOutput = useCallback((terminalId: string, data: string) => {
    // Route by pane id so subscriptions stay stable across bind/restart and
    // don't double-register when terminalId flips from null → id.
    const paneId = stateRef.current.bySession[terminalId];
    if (!paneId) return;
    const set = paneTerminalListeners.current.get(paneId);
    if (!set) return;
    for (const cb of set) cb(data);
  }, []);

  const onEngineEvent = useCallback(
    (event: EngineEvent) => {
      if (event.type === "session_created" || event.type === "terminal_created") {
        pendingCreates.current.delete(event.requestId);
        if (event.type === "session_created") {
          const pane = stateRef.current.panes.find((p) => p.id === event.requestId);
          if (!pane) {
            // Pane not in store yet (race) — bind when createSession runs again.
            orphanCreated.current.set(event.requestId, {
              sessionId: event.sessionId,
              branch: event.branch,
            });
          }
        }
      } else if (event.type === "error" && event.requestId) {
        pendingCreates.current.delete(event.requestId);
      }

      if (event.type === "terminal_output") {
        emitTerminalOutput(event.terminalId, event.data);
        return;
      }

      if (event.type === "session_diff") {
        setReview((r) => ({
          ...r,
          open: true,
          sessionId: event.sessionId,
          files: event.files,
          loading: false,
          canRestore: event.canRestoreFromCheckpoint,
        }));
        return;
      }
      if (event.type === "restore_files_result") {
        const n = event.restored.length + event.removed.length;
        if (event.errors.length) {
          toastError("Some files failed", event.errors.slice(0, 2).join("; "));
        } else {
          toastSuccess(
            n === 1 ? "Rejected 1 file" : `Rejected ${n} files`,
            "Restored from checkpoint/HEAD",
          );
        }
        // Refresh diff
        if (event.sessionId) {
          clientRef.current?.send({
            type: "get_session_diff",
            requestId: nextReq(),
            sessionId: event.sessionId,
          });
          setReview((r) => ({ ...r, loading: true }));
        }
        return;
      }
      if (event.type === "worktrees") {
        setWorktrees(event.items);
        setWorktreesLoading(false);
        return;
      }
      if (event.type === "worktree_action_result") {
        if (event.ok) toastSuccess(event.message);
        else toastError("Worktree action failed", event.message);
        return;
      }

      // Review/worktree events handled above; no-op branch removed.
      const next = apply({ type: "engine", event });
      if (event.type === "sessions_snapshot" || event.type === "terminals_snapshot") {
        if (event.type === "sessions_snapshot" && !bootstrapped.current) {
          bootstrapped.current = true;
        }
        ensureSessions(next);
      }
    },
    [apply, emitTerminalOutput, ensureSessions],
  );

  const onStatus = useCallback(
    (status: State["status"]) => {
      const prev = stateRef.current.status;
      apply({ type: "status", status });
      if (status === "closed" && prev === "open") {
        toastInfo("Engine disconnected", "Reconnecting…");
        return;
      }
      if (status !== "open") return;
      if (prev === "closed") toastSuccess("Engine reconnected");
      clientRef.current?.send({ type: "list_sessions" });
      clientRef.current?.send({ type: "list_terminals" });
      window.setTimeout(() => {
        if (bootstrapped.current) return;
        bootstrapped.current = true;
        ensureSessions(stateRef.current);
      }, 400);
    },
    [apply, ensureSessions],
  );

  // Stable callbacks for the socket lifetime (refs avoid reconnect storms).
  const onEngineEventRef = useRef(onEngineEvent);
  onEngineEventRef.current = onEngineEvent;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  /**
   * Empty panes (no chat yet) follow the top-bar picker. Sessions with history
   * keep their original provider — change those by opening a new session.
   */
  const rebindEmptyPanes = useCallback(
    (provider: string, model: string) => {
      for (const pane of stateRef.current.panes) {
        if (!isEmptyPane(pane)) continue;
        if (pane.provider === provider && pane.model === model) continue;

        if (pane.sessionId) {
          clientRef.current?.send({ type: "close_session", sessionId: pane.sessionId });
        }
        pendingCreates.current.delete(pane.id);
        orphanCreated.current.delete(pane.id);
        apply({
          type: "rebind_pane",
          paneId: pane.id,
          provider,
          model,
          notice: `switched to ${provider} · ${model}`,
        });
        createSession(pane.id, { provider, model, force: true });
      }
    },
    [apply, createSession],
  );

  const addPane = useCallback(() => {
    const paneId = nextPaneId();
    const workspaceId = stateRef.current.activeWorkspaceId;
    const count = stateRef.current.panes.filter(
      (p) => p.workspaceId === workspaceId && p.kind === "agent",
    ).length;
    const provider = stateRef.current.provider;
    const model = stateRef.current.model;
    apply({ type: "add_pane", paneId, workspaceId, title: `session ${count + 1}`, kind: "agent" });
    // Defer so React commit / orphan bind can't race the create handshake.
    queueMicrotask(() => createSession(paneId, { provider, model, force: true }));
  }, [apply, createSession]);

  const retryPane = useCallback(
    (paneId: string) => {
      const pane = stateRef.current.panes.find((p) => p.id === paneId);
      if (!pane) return;
      pendingCreates.current.delete(paneId);
      if (pane.kind === "terminal") {
        createTerminal(paneId, 80, 24, true);
        return;
      }
      createSession(paneId, {
        provider: pane.provider,
        model: pane.model,
        force: true,
      });
    },
    [createSession, createTerminal],
  );

  const addTerminalPane = useCallback(() => {
    const paneId = nextPaneId();
    const workspaceId = stateRef.current.activeWorkspaceId;
    const count = stateRef.current.panes.filter(
      (p) => p.workspaceId === workspaceId && p.kind === "terminal",
    ).length;
    apply({
      type: "add_pane",
      paneId,
      workspaceId,
      title: count === 0 ? "terminal" : `terminal ${count + 1}`,
      kind: "terminal",
    });
    queueMicrotask(() => createTerminal(paneId, 80, 24, true));
  }, [apply, createTerminal]);

  const addWorkspace = useCallback(() => {
    const workspaceId = nextWorkspaceId();
    apply({ type: "add_workspace", workspaceId, name: `Workspace ${workspaceCounter}` });
    const paneId = nextPaneId();
    const provider = stateRef.current.provider;
    const model = stateRef.current.model;
    apply({ type: "add_pane", paneId, workspaceId, title: "session 1", kind: "agent" });
    queueMicrotask(() => createSession(paneId, { provider, model, force: true }));
  }, [apply, createSession]);

  const selectWorkspace = useCallback(
    (workspaceId: string) => {
      apply({ type: "select_workspace", workspaceId });
    },
    [apply],
  );

  const renameWorkspace = useCallback(
    (workspaceId: string, name: string) => {
      const trimmed = name.trim();
      if (trimmed) apply({ type: "rename_workspace", workspaceId, name: trimmed });
    },
    [apply],
  );

  const deleteWorkspace = useCallback(
    (workspaceId: string) => {
      const s = stateRef.current;
      if (s.workspaces.length <= 1) return;
      for (const pane of s.panes.filter((p) => p.workspaceId === workspaceId)) {
        if (pane.sessionId) {
          clientRef.current?.send({ type: "close_session", sessionId: pane.sessionId });
        }
        if (pane.terminalId) {
          clientRef.current?.send({ type: "close_terminal", terminalId: pane.terminalId });
        }
      }
      apply({ type: "delete_workspace", workspaceId });
    },
    [apply],
  );

  const setProvider = useCallback(
    (provider: string) => {
      const model = MODELS_BY_PROVIDER[provider]?.[0] ?? stateRef.current.model;
      apply({ type: "set_provider", provider });
      rebindEmptyPanes(provider, model);
    },
    [apply, rebindEmptyPanes],
  );

  const setModel = useCallback(
    (model: string) => {
      apply({ type: "set_model", model });
      rebindEmptyPanes(stateRef.current.provider, model);
    },
    [apply, rebindEmptyPanes],
  );

  const setIsolate = useCallback(
    (isolate: boolean) => {
      apply({ type: "set_isolate", isolate });
    },
    [apply],
  );

  const sendMessage = useCallback(
    (paneId: string, text: string) => {
      const pane = stateRef.current.panes.find((p) => p.id === paneId);
      if (!pane?.sessionId || pane.kind === "terminal") return;
      apply({ type: "user_message", paneId, text });
      clientRef.current?.send({ type: "send_message", sessionId: pane.sessionId, text });
    },
    [apply],
  );

  const closePane = useCallback(
    (paneId: string) => {
      const pane = stateRef.current.panes.find((p) => p.id === paneId);
      if (pane?.sessionId) {
        clientRef.current?.send({ type: "close_session", sessionId: pane.sessionId });
      }
      if (pane?.terminalId) {
        clientRef.current?.send({ type: "close_terminal", terminalId: pane.terminalId });
      }
      paneTerminalListeners.current.delete(paneId);
      pendingCreates.current.delete(paneId);
      apply({ type: "close_pane", paneId });
    },
    [apply],
  );

  const respondPermission = useCallback(
    (paneId: string, requestId: string, decision: PermissionDecision) => {
      const pane = stateRef.current.panes.find((p) => p.id === paneId);
      if (!pane?.sessionId) return;
      clientRef.current?.send({
        type: "permission_response",
        sessionId: pane.sessionId,
        requestId,
        decision,
      });
      apply({ type: "clear_permission", paneId, decision });
    },
    [apply],
  );

  const undo = useCallback(
    (paneId: string) => {
      const pane = stateRef.current.panes.find((p) => p.id === paneId);
      if (!pane?.sessionId || !pane.canUndo) return;
      clientRef.current?.send({ type: "undo", sessionId: pane.sessionId });
      apply({ type: "add_notice", paneId, text: "↩ reverted last turn's file changes" });
      toastSuccess("Undid last turn", "File changes restored from checkpoint");
    },
    [apply],
  );

  const stopTurn = useCallback(
    (paneId: string) => {
      const pane = stateRef.current.panes.find((p) => p.id === paneId);
      if (!pane?.sessionId || !pane.running) return;
      clientRef.current?.send({ type: "interrupt", sessionId: pane.sessionId });
      apply({ type: "stop_turn", paneId });
    },
    [apply],
  );

  const stopAll = useCallback(() => {
    let n = 0;
    for (const pane of stateRef.current.panes) {
      if (pane.sessionId && pane.running) {
        clientRef.current?.send({ type: "interrupt", sessionId: pane.sessionId });
        apply({ type: "stop_turn", paneId: pane.id });
        n += 1;
      }
    }
    if (n > 0) toastInfo(`Stopped ${n} running turn${n === 1 ? "" : "s"}`);
    else toastInfo("Nothing running");
  }, [apply]);

  const closeAllPanesInWorkspace = useCallback(() => {
    const ws = stateRef.current.activeWorkspaceId;
    const panes = stateRef.current.panes.filter((p) => p.workspaceId === ws);
    for (const pane of panes) {
      if (pane.sessionId) {
        clientRef.current?.send({ type: "close_session", sessionId: pane.sessionId });
      }
      if (pane.terminalId) {
        clientRef.current?.send({ type: "close_terminal", terminalId: pane.terminalId });
      }
      paneTerminalListeners.current.delete(pane.id);
      pendingCreates.current.delete(pane.id);
      apply({ type: "close_pane", paneId: pane.id });
    }
    if (panes.length > 0) toastInfo(`Closed ${panes.length} pane${panes.length === 1 ? "" : "s"}`);
  }, [apply]);

  const writeTerminal = useCallback((terminalId: string, data: string) => {
    clientRef.current?.send({ type: "terminal_input", terminalId, data });
  }, []);

  const resizeTerminal = useCallback((terminalId: string, cols: number, rows: number) => {
    clientRef.current?.send({ type: "terminal_resize", terminalId, cols, rows });
  }, []);

  /**
   * Subscribe to PTY output for a terminal pane. Keyed by paneId only so the
   * listener set does not churn (or double-up) when terminalId is assigned.
   */
  const subscribeTerminalOutput = useCallback(
    (paneId: string, _terminalId: string | null, cb: TerminalOutputListener) => {
      let set = paneTerminalListeners.current.get(paneId);
      if (!set) {
        set = new Set();
        paneTerminalListeners.current.set(paneId, set);
      }
      set.add(cb);
      return () => {
        set!.delete(cb);
        if (set!.size === 0) paneTerminalListeners.current.delete(paneId);
      };
    },
    [],
  );

  const restartTerminal = useCallback(
    (paneId: string, cols = 80, rows = 24) => {
      const pane = stateRef.current.panes.find((p) => p.id === paneId);
      if (!pane || pane.kind !== "terminal") return;
      const prevId = pane.terminalId;
      if (prevId) {
        clientRef.current?.send({ type: "close_terminal", terminalId: prevId });
        apply({
          type: "engine",
          event: { type: "terminal_exit", terminalId: prevId, exitCode: null },
        });
      }
      pendingCreates.current.delete(paneId);
      window.setTimeout(() => createTerminal(paneId, cols, rows), 0);
    },
    [apply, createTerminal],
  );

  const openReview = useCallback((paneId: string) => {
    const pane = stateRef.current.panes.find((p) => p.id === paneId);
    if (!pane?.sessionId || pane.kind === "terminal") {
      toastInfo("No live agent session to review");
      return;
    }
    setReview({
      open: true,
      sessionId: pane.sessionId,
      paneTitle: pane.title,
      files: [],
      loading: true,
      canRestore: pane.canUndo,
    });
    toastInfo("Opening review…", pane.title);
    clientRef.current?.send({
      type: "get_session_diff",
      requestId: nextReq(),
      sessionId: pane.sessionId,
    });
  }, []);

  const closeReview = useCallback(() => {
    setReview((r) => ({ ...r, open: false }));
  }, []);

  const refreshReview = useCallback(() => {
    setReview((r) => {
      if (!r.sessionId) return r;
      clientRef.current?.send({
        type: "get_session_diff",
        requestId: nextReq(),
        sessionId: r.sessionId,
      });
      return { ...r, loading: true };
    });
  }, []);

  const rejectReviewPaths = useCallback((paths: string[]) => {
    setReview((r) => {
      if (!r.sessionId || paths.length === 0) return r;
      clientRef.current?.send({
        type: "restore_files",
        requestId: nextReq(),
        sessionId: r.sessionId,
        paths,
      });
      return { ...r, loading: true };
    });
  }, []);

  const refreshWorktrees = useCallback(() => {
    setWorktreesLoading(true);
    clientRef.current?.send({
      type: "list_worktrees",
      requestId: nextReq(),
      cwd: projectCwdRef.current,
    });
  }, []);

  const mergeWorktreeBranch = useCallback((branch: string) => {
    clientRef.current?.send({
      type: "merge_worktree_branch",
      requestId: nextReq(),
      cwd: projectCwdRef.current,
      branch,
    });
  }, []);

  const discardWorktreeBranch = useCallback((branch: string) => {
    clientRef.current?.send({
      type: "discard_worktree_branch",
      requestId: nextReq(),
      cwd: projectCwdRef.current,
      branch,
    });
  }, []);

  // One client for the page lifetime; reconnect is handled inside EngineClient.
  useEffect(() => {
    const client = new EngineClient(
      (event) => onEngineEventRef.current(event),
      (status) => onStatusRef.current(status),
    );
    clientRef.current = client;
    client.connect();
    return () => {
      client.dispose();
      clientRef.current = null;
    };
  }, []);

  // Watchdog: retry panes stuck without a session/terminal while connected.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (stateRef.current.status !== "open") return;
      ensureSessions(stateRef.current, { force: false });
    }, 2500);
    return () => clearInterval(id);
  }, [ensureSessions]);

  // Persist UI so full reloads can reattach. Debounced for chat streaming.
  useEffect(() => {
    const t = setTimeout(() => savePersistedState(state), 150);
    return () => clearTimeout(t);
  }, [state]);

  // Flush immediately on tab close / HMR so the last messages aren't lost.
  useEffect(() => {
    const flush = () => savePersistedState(stateRef.current);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, []);

  return {
    state,
    addPane,
    addTerminalPane,
    addWorkspace,
    selectWorkspace,
    renameWorkspace,
    deleteWorkspace,
    setProvider,
    setModel,
    setIsolate,
    setProjectCwd,
    sendMessage,
    closePane,
    closeAllPanesInWorkspace,
    respondPermission,
    undo,
    stopTurn,
    stopAll,
    writeTerminal,
    resizeTerminal,
    subscribeTerminalOutput,
    restartTerminal,
    createTerminal,
    retryPane,
    review,
    openReview,
    closeReview,
    refreshReview,
    rejectReviewPaths,
    worktrees,
    worktreesLoading,
    refreshWorktrees,
    mergeWorktreeBranch,
    discardWorktreeBranch,
  };
}
