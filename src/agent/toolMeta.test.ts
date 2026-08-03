import { describe, expect, it } from "vitest";
import { extractToolLinks, summarizeToolInput } from "./toolMeta.js";

describe("summarizeToolInput", () => {
  it("summarizes WebSearch query", () => {
    expect(summarizeToolInput("WebSearch", { query: "rust async" })).toBe("rust async");
  });

  it("summarizes WebFetch url", () => {
    expect(summarizeToolInput("WebFetch", { url: "https://example.com/a" })).toBe(
      "https://example.com/a",
    );
  });
});

describe("extractToolLinks", () => {
  it("extracts Claude WebSearchOutput hits", () => {
    const links = extractToolLinks({
      query: "vibeshell",
      results: [
        {
          tool_use_id: "tu_1",
          content: [
            { title: "Example", url: "https://example.com/page" },
            { title: "Docs", url: "https://docs.example.com/" },
          ],
        },
      ],
      durationSeconds: 1,
    });
    expect(links).toEqual([
      { url: "https://example.com/page", title: "Example" },
      { url: "https://docs.example.com/", title: "Docs" },
    ]);
  });

  it("extracts urls from free text and dedupes", () => {
    const links = extractToolLinks(
      "See https://a.example/x and https://a.example/x again plus https://b.example/",
    );
    expect(links.map((l) => l.url)).toEqual([
      "https://a.example/x",
      "https://b.example/",
    ]);
  });

  it("extracts WebFetch url field", () => {
    expect(extractToolLinks({ url: "https://fetched.example/doc", bytes: 12 })).toEqual([
      { url: "https://fetched.example/doc" },
    ]);
  });
});
