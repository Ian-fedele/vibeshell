/**
 * Wire contract with the engine sidecar. Mirrors src/engine/protocol.ts and
 * src/agent/types.ts in the engine package. Kept in sync by hand for now;
 * a shared types package is a later cleanup.
 */
export type ToolPreview =
  | { kind: "edit"; path: string; before: string; after: string }
  | { kind: "write"; path: string; content: string }
  | { kind: "bash"; command: string }
  | { kind: "other"; summary: string };

export type PermissionDecision =
  | { type: "allow" }
  | { type: "allow_always" }
  | { type: "deny"; message?: string };

export interface ToolLink {
  url: string;
  title?: string;
}

export type AgentEvent =
  | { type: "text"; text: string }
  | {
      type: "tool";
      name?: string;
      id?: string;
      detail?: string;
      status?: "running" | "done" | "error";
      links?: ToolLink[];
    }
  | { type: "permission_request"; requestId: string; toolName: string; title?: string; preview: ToolPreview }
  | { type: "result"; ok: boolean; durationMs: number; tokens: number; reason?: string };

export type ClientCommand =
  | {
      type: "create_session";
      requestId: string;
      provider: string;
      model: string;
      cwd: string;
      worktree?: boolean;
    }
  | { type: "send_message"; sessionId: string; text: string }
  | { type: "permission_response"; sessionId: string; requestId: string; decision: PermissionDecision }
  | { type: "undo"; sessionId: string }
  | { type: "interrupt"; sessionId: string }
  | { type: "close_session"; sessionId: string };

export type EngineEvent =
  | { type: "session_created"; requestId: string; sessionId: string; branch?: string }
  | { type: "agent_event"; sessionId: string; event: AgentEvent }
  | { type: "checkpoint"; sessionId: string; available: boolean }
  | { type: "session_closed"; sessionId: string }
  | { type: "error"; message: string; sessionId?: string; requestId?: string };
