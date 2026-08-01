/**
 * Provider-agnostic agent interface. Nothing outside src/agent/providers/
 * should import a vendor SDK — the rest of the app talks in these types, so a
 * new provider (OpenAI, etc.) is an adapter behind this seam, not a rewrite.
 */

export interface AgentSessionOptions {
  model: string;
  cwd: string;
}

/** Normalized, provider-agnostic events the UI renders. */
export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "result"; ok: boolean; durationMs: number; costUsd: number; reason?: string };

export interface AgentSession {
  /** Submit a user turn. */
  send(text: string): void;
  /** End the session; the event stream completes after the current turn. */
  close(): void;
  /** Interrupt the in-flight turn. */
  interrupt(): Promise<void>;
  /** Normalized events across every turn until close(). */
  events: AsyncIterable<AgentEvent>;
}

export interface AgentProvider {
  /** Stable id used to select the provider (e.g. "claude", "openai"). */
  readonly id: string;
  createSession(options: AgentSessionOptions): AgentSession;
}
