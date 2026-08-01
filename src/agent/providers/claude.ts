/**
 * Claude provider — the only module that imports the Claude Agent SDK.
 * Translates the SDK's message stream into our normalized AgentEvent stream.
 */
import {
  query,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { createInputPump, type InputPump } from "../inputPump.js";
import type {
  AgentEvent,
  AgentProvider,
  AgentSession,
  AgentSessionOptions,
} from "../types.js";

/** Map one SDK message to zero or more normalized events. Pure — unit-tested. */
export function toAgentEvents(msg: SDKMessage): AgentEvent[] {
  switch (msg.type) {
    case "assistant": {
      const events: AgentEvent[] = [];
      for (const block of msg.message.content) {
        if (block.type === "text") events.push({ type: "text", text: block.text });
        else if (block.type === "tool_use")
          events.push({ type: "tool", name: block.name });
      }
      return events;
    }
    case "result":
      return msg.subtype === "success"
        ? [
            {
              type: "result",
              ok: true,
              durationMs: msg.duration_ms,
              costUsd: msg.total_cost_usd,
            },
          ]
        : [{ type: "result", ok: false, durationMs: 0, costUsd: 0, reason: msg.subtype }];
    default:
      return [];
  }
}

async function* translate(src: AsyncIterable<SDKMessage>): AsyncIterable<AgentEvent> {
  for await (const msg of src) {
    for (const event of toAgentEvents(msg)) yield event;
  }
}

function createClaudeSession(options: AgentSessionOptions): AgentSession {
  const pump: InputPump<SDKUserMessage> = createInputPump();
  const q: Query = query({
    prompt: pump.iterable,
    options: { model: options.model, cwd: options.cwd },
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
    events: translate(q),
  };
}

export const claudeProvider: AgentProvider = {
  id: "claude",
  createSession: createClaudeSession,
};
