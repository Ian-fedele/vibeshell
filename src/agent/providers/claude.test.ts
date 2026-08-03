import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { toAgentEvents } from "./claude.js";
import { isAutoAllowed } from "../permissions.js";

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
            {
              type: "tool_use",
              name: "Read",
              id: "tu_read",
              input: { file_path: "a.ts" },
            },
          ],
        },
      }),
    );
    expect(events).toEqual([
      { type: "text", text: "Let me look." },
      {
        type: "tool",
        name: "Read",
        id: "tu_read",
        detail: "a.ts",
        status: "running",
      },
    ]);
  });

  it("maps WebSearch tool results to links", () => {
    const events = toAgentEvents(
      asMsg({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_ws",
              content: "search done",
            },
          ],
        },
        tool_use_result: {
          query: "xai grok",
          results: [
            {
              tool_use_id: "tu_ws",
              content: [{ title: "xAI", url: "https://x.ai" }],
            },
          ],
          durationSeconds: 0.5,
        },
      }),
    );
    expect(events).toEqual([
      {
        type: "tool",
        id: "tu_ws",
        status: "done",
        links: [{ url: "https://x.ai", title: "xAI" }],
      },
    ]);
  });

  it("maps a success result to duration and conversation size", () => {
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

  it("auto-allows read-only tools but gates writes and bash", () => {
    for (const t of ["Read", "Glob", "Grep", "LS"]) expect(isAutoAllowed(t)).toBe(true);
    for (const t of ["Edit", "Write", "Bash"]) expect(isAutoAllowed(t)).toBe(false);
  });
});
