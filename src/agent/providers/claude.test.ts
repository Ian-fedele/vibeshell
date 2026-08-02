import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { toAgentEvents } from "./claude.js";

// The SDKMessage union is large; build minimal shapes and assert the mapping.
const asMsg = (o: unknown): SDKMessage => o as SDKMessage;

describe("toAgentEvents", () => {
  it("maps assistant text and tool_use blocks in order", () => {
    const events = toAgentEvents(
      asMsg({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Let me look." },
            { type: "tool_use", name: "Read" },
          ],
        },
      }),
    );
    expect(events).toEqual([
      { type: "text", text: "Let me look." },
      { type: "tool", name: "Read" },
    ]);
  });

  it("maps a success result to duration and total tokens", () => {
    const events = toAgentEvents(
      asMsg({
        type: "result",
        subtype: "success",
        duration_ms: 3200,
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
          cache_read_input_tokens: 50,
          cache_creation_input_tokens: 10,
        },
      }),
    );
    expect(events).toEqual([
      { type: "result", ok: true, durationMs: 3200, tokens: 1260 },
    ]);
  });

  it("maps an error result to a reason", () => {
    const events = toAgentEvents(asMsg({ type: "result", subtype: "error_max_turns" }));
    expect(events).toEqual([
      { type: "result", ok: false, durationMs: 0, tokens: 0, reason: "error_max_turns" },
    ]);
  });

  it("ignores unrelated message types", () => {
    expect(toAgentEvents(asMsg({ type: "system" }))).toEqual([]);
  });
});
