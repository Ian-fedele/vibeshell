/**
 * IPC contract between the front-end (webview) and the engine (Node sidecar).
 * Transport-agnostic — the same messages flow over a WebSocket, stdio, or an
 * in-process callback. Session ids are engine-assigned; requests correlate via
 * requestId until the id is known.
 */
import type { AgentEvent, PermissionDecision } from "../agent/index.js";

/** Front-end → engine. */
export type ClientCommand =
  | {
      type: "create_session";
      requestId: string;
      provider: string;
      model: string;
      cwd: string;
    }
  | { type: "send_message"; sessionId: string; text: string }
  | {
      type: "permission_response";
      sessionId: string;
      requestId: string;
      decision: PermissionDecision;
    }
  | { type: "undo"; sessionId: string }
  | { type: "interrupt"; sessionId: string }
  | { type: "close_session"; sessionId: string };

/** Engine → front-end. */
export type EngineEvent =
  | { type: "session_created"; requestId: string; sessionId: string }
  | { type: "agent_event"; sessionId: string; event: AgentEvent }
  | { type: "checkpoint"; sessionId: string; available: boolean }
  | { type: "session_closed"; sessionId: string }
  | { type: "error"; message: string; sessionId?: string; requestId?: string };
