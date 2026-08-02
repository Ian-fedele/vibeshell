/**
 * Wires a single EngineClient to the session store and exposes pane actions.
 * On reconnect it recreates a fresh engine session for every open pane (the
 * sidecar is in-memory per connection, so a dropped connection loses its
 * sessions) — this is the robust-reconnect behavior.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { EngineClient } from "./engine";
import type { PermissionDecision } from "./protocol";
import { initialState, reducer, type State } from "./store";

const MODEL = "claude-opus-5";
const PROVIDER = "claude";

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

  const createSession = useCallback((paneId: string) => {
    clientRef.current?.send({
      type: "create_session",
      requestId: paneId,
      provider: PROVIDER,
      model: MODEL,
      cwd: ".",
    });
  }, []);

  const addPane = useCallback(() => {
    const paneId = nextPaneId();
    const workspaceId = stateRef.current.activeWorkspaceId;
    const count = stateRef.current.panes.filter((p) => p.workspaceId === workspaceId).length;
    dispatch({ type: "add_pane", paneId, workspaceId, title: `session ${count + 1}` });
    createSession(paneId);
  }, [createSession]);

  const addWorkspace = useCallback(() => {
    const workspaceId = nextWorkspaceId();
    dispatch({ type: "add_workspace", workspaceId, name: `Workspace ${workspaceCounter}` });
    // A fresh workspace starts with one ready session.
    const paneId = nextPaneId();
    dispatch({ type: "add_pane", paneId, workspaceId, title: "session 1" });
    createSession(paneId);
  }, [createSession]);

  const selectWorkspace = useCallback((workspaceId: string) => {
    dispatch({ type: "select_workspace", workspaceId });
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
      for (const pane of stateRef.current.panes) createSession(pane.id);
    }
    prevStatus.current = state.status;
  }, [state.status, createSession]);

  return {
    state,
    addPane,
    addWorkspace,
    selectWorkspace,
    sendMessage,
    closePane,
    respondPermission,
    undo,
  };
}
