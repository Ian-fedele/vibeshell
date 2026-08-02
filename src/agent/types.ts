/**
 * Provider-agnostic agent interface. Nothing outside src/agent/providers/
 * should import a vendor SDK — the rest of the app talks in these types, so a
 * new provider (OpenAI, etc.) is an adapter behind this seam, not a rewrite.
 */

export interface AgentSessionOptions {
  model: string;
  cwd: string;
}

/** A normalized preview of what a tool is about to do, for the approval UI. */
export type ToolPreview =
  | { kind: "edit"; path: string; before: string; after: string }
  | { kind: "write"; path: string; content: string }
  | { kind: "bash"; command: string }
  | { kind: "other"; summary: string };

/** The user's answer to a permission request. */
export type PermissionDecision =
  { type: "allow" } | { type: "allow_always" } | { type: "deny"; message?: string };

/** Normalized, provider-agnostic events the UI renders. */
export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | {
      type: "permission_request";
      requestId: string;
      toolName: string;
      title?: string;
      preview: ToolPreview;
    }
  | { type: "result"; ok: boolean; durationMs: number; costUsd: number; reason?: string };

export interface AgentSession {
  /** Submit a user turn. */
  send(text: string): void;
  /** End the session; the event stream completes after the current turn. */
  close(): void;
  /** Interrupt the in-flight turn. */
  interrupt(): Promise<void>;
  /** Answer a pending permission_request (by its requestId). */
  respondPermission(requestId: string, decision: PermissionDecision): void;
  /** Normalized events across every turn until close(). */
  events: AsyncIterable<AgentEvent>;
}

export interface AgentProvider {
  /** Stable id used to select the provider (e.g. "claude", "openai"). */
  readonly id: string;
  createSession(options: AgentSessionOptions): AgentSession;
}
