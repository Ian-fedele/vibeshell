/**
 * Wires a single EngineClient to the session store and exposes pane actions.
 * On reconnect it recreates a fresh engine session for every open pane (the
 * sidecar is in-memory per connection, so a dropped connection loses its
 * sessions) — this is the robust-reconnect behavior.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { EngineClient } from "./engine";
import type { PermissionDecision } from "./protocol";
import {
  initialState,
  isEmptyPane,
  MODELS_BY_PROVIDER,
  reducer,
  type State,
} from "./store";

let paneCounter = 0;
let workspaceCounter = 1; // Workspace 1 exists in initialState
const nextPaneId = (): string => `pane_${++paneCounter}`;
const nextWorkspaceId = (): string => `ws_${++workspaceCounter}`;

export function useEngine() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef<State>(state);
  stateRef.current = state;
  const clientRef = useRef<EngineClient | null>(null);
  const prevStatus = useRef(state.status);

  /** Always pass provider/model explicitly — never rely on a pane that was
   * just dispatched and is not in stateRef yet. */
  const createSession = useCallback(
    (paneId: string, opts?: { provider?: string; model?: string; worktree?: boolean }) => {
      const pane = stateRef.current.panes.find((p) => p.id === paneId);
      const provider =
        opts?.provider ?? pane?.provider ?? stateRef.current.provider;
      const model = opts?.model ?? pane?.model ?? stateRef.current.model;
      clientRef.current?.send({
        type: "create_session",
        requestId: paneId,
        provider,
        model,
        cwd: ".",
        worktree: opts?.worktree ?? stateRef.current.isolate,
      });
    },
    [],
  );

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
        dispatch({
          type: "rebind_pane",
          paneId: pane.id,
          provider,
          model,
          notice: `switched to ${provider} · ${model}`,
        });
        createSession(pane.id, { provider, model });
      }
    },
    [createSession],
  );

  const addPane = useCallback(() => {
    const paneId = nextPaneId();
    const workspaceId = stateRef.current.activeWorkspaceId;
    const count = stateRef.current.panes.filter((p) => p.workspaceId === workspaceId).length;
    const provider = stateRef.current.provider;
    const model = stateRef.current.model;
    dispatch({ type: "add_pane", paneId, workspaceId, title: `session ${count + 1}` });
    createSession(paneId, { provider, model });
  }, [createSession]);

  const addWorkspace = useCallback(() => {
    const workspaceId = nextWorkspaceId();
    dispatch({ type: "add_workspace", workspaceId, name: `Workspace ${workspaceCounter}` });
    // A fresh workspace starts with one ready session.
    const paneId = nextPaneId();
    const provider = stateRef.current.provider;
    const model = stateRef.current.model;
    dispatch({ type: "add_pane", paneId, workspaceId, title: "session 1" });
    createSession(paneId, { provider, model });
  }, [createSession]);

  const selectWorkspace = useCallback((workspaceId: string) => {
    dispatch({ type: "select_workspace", workspaceId });
  }, []);

  const renameWorkspace = useCallback((workspaceId: string, name: string) => {
    const trimmed = name.trim();
    if (trimmed) dispatch({ type: "rename_workspace", workspaceId, name: trimmed });
  }, []);

  const deleteWorkspace = useCallback((workspaceId: string) => {
    const s = stateRef.current;
    if (s.workspaces.length <= 1) return; // keep at least one
    for (const pane of s.panes.filter((p) => p.workspaceId === workspaceId)) {
      if (pane.sessionId) clientRef.current?.send({ type: "close_session", sessionId: pane.sessionId });
    }
    dispatch({ type: "delete_workspace", workspaceId });
  }, []);

  const setProvider = useCallback(
    (provider: string) => {
      const model = MODELS_BY_PROVIDER[provider]?.[0] ?? stateRef.current.model;
      dispatch({ type: "set_provider", provider });
      // Apply immediately to empty panes (including the auto-created starter).
      rebindEmptyPanes(provider, model);
    },
    [rebindEmptyPanes],
  );

  const setModel = useCallback(
    (model: string) => {
      dispatch({ type: "set_model", model });
      rebindEmptyPanes(stateRef.current.provider, model);
    },
    [rebindEmptyPanes],
  );

  const setIsolate = useCallback((isolate: boolean) => {
    dispatch({ type: "set_isolate", isolate });
  }, []);

  const sendMessage = useCallback((paneId: string, text: string) => {
    const pane = stateRef.current.panes.find((p) => p.id === paneId);
    if (!pane?.sessionId) return;
    dispatch({ type: "user_message", paneId, text });
    clientRef.current?.send({ type: "send_message", sessionId: pane.sessionId, text });
  }, []);

  const closePane = useCallback((paneId: string) => {
    const pane = stateRef.current.panes.find((p) => p.id === paneId);
    if (pane?.sessionId) clientRef.current?.send({ type: "close_session", sessionId: pane.sessionId });
    dispatch({ type: "close_pane", paneId });
  }, []);

  const respondPermission = useCallback(
    (paneId: string, requestId: string, decision: PermissionDecision) => {
      const pane = stateRef.current.panes.find((p) => p.id === paneId);
      if (!pane?.sessionId) return;
      clientRef.current?.send({ type: "permission_response", sessionId: pane.sessionId, requestId, decision });
      dispatch({ type: "clear_permission", paneId, decision });
    },
    [],
  );

  const undo = useCallback((paneId: string) => {
    const pane = stateRef.current.panes.find((p) => p.id === paneId);
    if (!pane?.sessionId || !pane.canUndo) return;
    clientRef.current?.send({ type: "undo", sessionId: pane.sessionId });
    dispatch({ type: "add_notice", paneId, text: "↩ reverted last turn's file changes" });
  }, []);

  const stopTurn = useCallback((paneId: string) => {
    const pane = stateRef.current.panes.find((p) => p.id === paneId);
    if (!pane?.sessionId || !pane.running) return;
    clientRef.current?.send({ type: "interrupt", sessionId: pane.sessionId });
    dispatch({ type: "stop_turn", paneId });
  }, []);

  // Connect once, open the first pane.
  useEffect(() => {
    if (clientRef.current) return; // guard StrictMode double-invoke
    clientRef.current = new EngineClient(
      (event) => dispatch({ type: "engine", event }),
      (status) => dispatch({ type: "status", status }),
    );
    clientRef.current.connect();
    addPane();
  }, [addPane]);

  // Recreate sessions for existing panes after a reconnect (not the first open).
  useEffect(() => {
    if (state.status === "open" && prevStatus.current === "closed") {
      for (const pane of stateRef.current.panes) {
        createSession(pane.id, { provider: pane.provider, model: pane.model });
      }
    }
    prevStatus.current = state.status;
  }, [state.status, createSession]);

  return {
    state,
    addPane,
    addWorkspace,
    selectWorkspace,
    renameWorkspace,
    deleteWorkspace,
    setProvider,
    setModel,
    setIsolate,
    sendMessage,
    closePane,
    respondPermission,
    undo,
    stopTurn,
  };
}
