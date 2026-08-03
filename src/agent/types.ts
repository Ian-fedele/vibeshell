/**
 * Provider-agnostic agent interface. Nothing outside src/agent/providers/
 * should import a vendor SDK — the rest of the app talks in these types, so a
 * new provider (OpenAI, etc.) is an adapter behind this seam, not a rewrite.
 */

/** Prior turns to rehydrate after an engine/UI restart. */
export type TranscriptTurn = { role: "user" | "assistant"; text: string };

export interface AgentSessionOptions {
  model: string;
  cwd: string;
  /**
   * Optional prior conversation. Providers inject this into system context so
   * a restarted session can continue without replaying UI messages as new turns.
   */
  history?: TranscriptTurn[];
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

/** A clickable citation / visited page from a tool (web search, fetch, …). */
export interface ToolLink {
  url: string;
  title?: string;
}

/** Normalized, provider-agnostic events the UI renders. */
export type AgentEvent =
  | { type: "text"; text: string }
  | {
      type: "tool";
      /** Tool name on start; may be omitted on status/link updates matched by id. */
      name?: string;
      /** Provider tool-call id when available (used to merge start + result). */
      id?: string;
      /** One-line detail (search query, URL, path, command). */
      detail?: string;
      status?: "running" | "done" | "error";
      /** Sites visited / search hits — rendered as clickable chips. */
      links?: ToolLink[];
    }
  | {
      type: "permission_request";
      requestId: string;
      toolName: string;
      title?: string;
      preview: ToolPreview;
    }
  | { type: "result"; ok: boolean; durationMs: number; tokens: number; reason?: string };

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

/** Format transcript turns for system-prompt rehydration. */
export function formatHistoryForPrompt(
  history: TranscriptTurn[] | undefined,
): string | undefined {
  if (!history?.length) return undefined;
  const lines = history
    .filter((t) => t.text.trim())
    .slice(-40) // keep the prompt bounded
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text.trim()}`);
  if (lines.length === 0) return undefined;
  return [
    "The following is the prior conversation from a previous session that was restored after a restart.",
    "Continue as if you already had this context. Do not re-greet or re-summarize unless the user asks.",
    "",
    lines.join("\n\n"),
  ].join("\n");
}
