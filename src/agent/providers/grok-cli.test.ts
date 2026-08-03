import { describe, expect, it } from "vitest";
import { mapGrokStreamLine } from "./grok-cli.js";

describe("mapGrokStreamLine", () => {
  it("maps text chunks", () => {
    expect(mapGrokStreamLine(JSON.stringify({ type: "text", data: "hi" }))).toEqual({
      events: [{ type: "text", text: "hi" }],
    });
  });

  it("maps tool_call using toolName and detail", () => {
    expect(
      mapGrokStreamLine(
        JSON.stringify({
          type: "tool_call",
          toolCallId: "c1",
          toolName: "web_search",
          title: "Web Search",
          rawInput: { query: "site:x.ai grok" },
          status: "in_progress",
        }),
      ),
    ).toEqual({
      events: [
        {
          type: "tool",
          name: "web_search",
          id: "c1",
          detail: "site:x.ai grok",
          status: "running",
        },
      ],
    });
  });

  it("maps tool_call_update links from rawOutput", () => {
    expect(
      mapGrokStreamLine(
        JSON.stringify({
          type: "tool_call_update",
          toolCallId: "c1",
          status: "completed",
          rawOutput: {
            results: [{ title: "Docs", url: "https://docs.x.ai/build" }],
          },
        }),
      ),
    ).toEqual({
      events: [
        {
          type: "tool",
          id: "c1",
          status: "done",
          links: [{ url: "https://docs.x.ai/build", title: "Docs" }],
        },
      ],
    });
  });

  it("maps end with sessionId and tokens", () => {
    const mapped = mapGrokStreamLine(
      JSON.stringify({
        type: "end",
        sessionId: "sess_abc",
        usage: { total_tokens: 1200 },
      }),
    );
    expect(mapped.sessionId).toBe("sess_abc");
    expect(mapped.events).toEqual([
      { type: "result", ok: true, durationMs: 0, tokens: 1200 },
    ]);
  });

  it("maps error frames", () => {
    expect(
      mapGrokStreamLine(JSON.stringify({ type: "error", message: "auth failed" })),
    ).toEqual({
      events: [
        { type: "result", ok: false, durationMs: 0, tokens: 0, reason: "auth failed" },
      ],
    });
  });

  it("ignores thoughts and garbage", () => {
    expect(mapGrokStreamLine(JSON.stringify({ type: "thought", data: "..." }))).toEqual({
      events: [],
    });
    expect(mapGrokStreamLine("not-json")).toEqual({ events: [] });
  });
});
