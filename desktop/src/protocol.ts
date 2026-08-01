/**
 * Wire contract with the engine sidecar. Mirrors src/engine/protocol.ts and
 * src/agent/types.ts in the engine package. Kept in sync by hand for now;
 * a shared types package is a later cleanup.
 */
export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "result"; ok: boolean; durationMs: number; costUsd: number; reason?: string };

export type ClientCommand =
  | { type: "create_session"; requestId: string; provider: string; model: string; cwd: string }
  | { type: "send_message"; sessionId: string; text: string }
  | { type: "interrupt"; sessionId: string }
  | { type: "close_session"; sessionId: string };

export type EngineEvent =
  | { type: "session_created"; requestId: string; sessionId: string }
  | { type: "agent_event"; sessionId: string; event: AgentEvent }
  | { type: "session_closed"; sessionId: string }
  | { type: "error"; message: string; sessionId?: string; requestId?: string };
