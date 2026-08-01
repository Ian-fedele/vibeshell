/**
 * Wires a single EngineClient to the session store and exposes pane actions.
 * On reconnect it recreates a fresh engine session for every open pane (the
 * sidecar is in-memory per connection, so a dropped connection loses its
 * sessions) — this is the robust-reconnect behavior.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { EngineClient } from "./engine";
import { initialState, reducer, type State } from "./store";

const MODEL = "claude-opus-5";
const PROVIDER = "claude";

let paneCounter = 0;
const nextPaneId = (): string => `pane_${++paneCounter}`;

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
    const title = `session ${stateRef.current.panes.length + 1}`;
    dispatch({ type: "add_pane", paneId, title });
    createSession(paneId);
  }, [createSession]);

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

  return { state, addPane, sendMessage, closePane };
}
