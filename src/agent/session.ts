/**
 * The only module that imports the Claude Agent SDK. Everything else talks to
 * the agent through this surface, so an SDK upgrade touches one file.
 */
import { query, type Query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { createInputPump, type InputPump } from "./inputPump.js";

export type { SDKMessage };

export interface SessionOptions {
  model: string;
  cwd: string;
}

export interface Session {
  /** Submit a user turn. */
  send(text: string): void;
  /** End the session; the message stream completes after the current turn. */
  close(): void;
  /** Interrupt the in-flight turn (streaming-input control request). */
  interrupt(): Promise<void>;
  /** All messages the agent emits, across every turn, until close(). */
  messages: AsyncIterable<SDKMessage>;
}

export function createSession(options: SessionOptions): Session {
  const pump: InputPump<SDKUserMessage> = createInputPump();

  const q: Query = query({
    prompt: pump.iterable,
    options: {
      model: options.model,
      cwd: options.cwd,
    },
  });

  return {
    send(text: string): void {
      pump.push({
        type: "user",
        message: { role: "user", content: text },
        parent_tool_use_id: null,
      });
    },
    close(): void {
      pump.end();
    },
    async interrupt(): Promise<void> {
      await q.interrupt();
    },
    messages: q,
  };
}
