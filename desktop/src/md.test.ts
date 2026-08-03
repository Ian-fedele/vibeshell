import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./md";

describe("parseInline", () => {
  it("parses bold, italic, underline, strike, code", () => {
    const nodes = parseInline("**Grok** is *great* and ++underlined++ ~~old~~ `x`");
    expect(nodes).toEqual([
      { type: "strong", children: [{ type: "text", value: "Grok" }] },
      { type: "text", value: " is " },
      { type: "em", children: [{ type: "text", value: "great" }] },
      { type: "text", value: " and " },
      { type: "u", children: [{ type: "text", value: "underlined" }] },
      { type: "text", value: " " },
      { type: "del", children: [{ type: "text", value: "old" }] },
      { type: "text", value: " " },
      { type: "code", value: "x" },
    ]);
  });

  it("parses <u> underline tags", () => {
    expect(parseInline("say <u>hi</u>")).toEqual([
      { type: "text", value: "say " },
      { type: "u", children: [{ type: "text", value: "hi" }] },
    ]);
  });

  it("parses safe links", () => {
    expect(parseInline("[docs](https://x.ai)")).toEqual([
      {
        type: "link",
        href: "https://x.ai",
        children: [{ type: "text", value: "docs" }],
      },
    ]);
  });

  it("leaves incomplete markers as text", () => {
    expect(parseInline("**not closed")).toEqual([
      { type: "text", value: "**not closed" },
    ]);
  });

  it("does not italicize snake_case identifiers", () => {
    expect(parseInline("see file_path here")).toEqual([
      { type: "text", value: "see file_path here" },
    ]);
  });
});

describe("parseMarkdown", () => {
  it("splits paragraphs and code fences", () => {
    const blocks = parseMarkdown("Hello **world**\n\n```ts\nconst x = 1\n```");
    expect(blocks[0]).toEqual({
      type: "paragraph",
      children: [
        { type: "text", value: "Hello " },
        { type: "strong", children: [{ type: "text", value: "world" }] },
      ],
    });
    expect(blocks[1]).toEqual({
      type: "code_block",
      lang: "ts",
      value: "const x = 1",
    });
  });

  it("parses lists and headings", () => {
    const blocks = parseMarkdown("## Title\n\n- one\n- two\n\n1. a\n2. b");
    expect(blocks[0]).toMatchObject({ type: "heading", level: 2 });
    expect(blocks[1]).toMatchObject({ type: "list", ordered: false });
    expect(blocks[2]).toMatchObject({ type: "list", ordered: true });
  });
});
