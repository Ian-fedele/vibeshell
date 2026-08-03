import { describe, expect, it } from "vitest";
import { formatHistoryForPrompt } from "./types.js";

describe("formatHistoryForPrompt", () => {
  it("returns undefined for empty history", () => {
    expect(formatHistoryForPrompt(undefined)).toBeUndefined();
    expect(formatHistoryForPrompt([])).toBeUndefined();
  });

  it("formats turns for system rehydration", () => {
    const text = formatHistoryForPrompt([
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi there" },
    ]);
    expect(text).toContain("User: hello");
    expect(text).toContain("Assistant: hi there");
    expect(text).toContain("previous session");
  });
});
