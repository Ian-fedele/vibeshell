/**
 * Small markdown → AST for agent chat. Covers the marks models actually emit
 * (bold/italic/strike/code/links/headings/lists/fences) plus underline via
 * <u>…</u> or ++…++. No HTML pass-through beyond the underline tag — keeps
 * rendering XSS-safe without a sanitizer dependency.
 */

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "u"; children: InlineNode[] }
  | { type: "del"; children: InlineNode[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: InlineNode[] }
  | { type: "br" };

export type BlockNode =
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "heading"; level: 1 | 2 | 3; children: InlineNode[] }
  | { type: "code_block"; lang: string; value: string }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  | { type: "blockquote"; children: InlineNode[] };

/** Escape nothing at the AST layer — React text nodes handle that. */

function takeInlineCode(src: string, i: number): { node: InlineNode; next: number } | null {
  if (src[i] !== "`") return null;
  // Don't treat ``` as inline code opener at block level; callers avoid that.
  if (src[i + 1] === "`" && src[i + 2] === "`") return null;
  const end = src.indexOf("`", i + 1);
  if (end < 0) return null;
  return {
    node: { type: "code", value: src.slice(i + 1, end) },
    next: end + 1,
  };
}

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9]/.test(ch);
}

function takeDelimited(
  src: string,
  i: number,
  open: string,
  close: string,
  wrap: (children: InlineNode[]) => InlineNode,
  /** When true, reject matches that look like snake_case / mid-word *stars*. */
  wordBoundary = false,
): { node: InlineNode; next: number } | null {
  if (!src.startsWith(open, i)) return null;
  if (wordBoundary && isWordChar(src[i - 1])) return null;
  const start = i + open.length;
  // Prefer the first closer that also satisfies a trailing word boundary.
  let end = src.indexOf(close, start);
  while (end >= 0) {
    if (end === start) {
      end = src.indexOf(close, end + close.length);
      continue;
    }
    if (wordBoundary && isWordChar(src[end + close.length])) {
      end = src.indexOf(close, end + close.length);
      continue;
    }
    const inner = src.slice(start, end);
    // Don't treat a lone marker run as emphasis content.
    if (inner.trim() === "") {
      end = src.indexOf(close, end + close.length);
      continue;
    }
    return {
      node: wrap(parseInline(inner)),
      next: end + close.length,
    };
  }
  return null;
}

function takeLink(src: string, i: number): { node: InlineNode; next: number } | null {
  if (src[i] !== "[") return null;
  const closeLabel = src.indexOf("]", i + 1);
  if (closeLabel < 0 || src[closeLabel + 1] !== "(") return null;
  const closeHref = src.indexOf(")", closeLabel + 2);
  if (closeHref < 0) return null;
  const label = src.slice(i + 1, closeLabel);
  const href = src.slice(closeLabel + 2, closeHref).trim();
  // Only allow safe URL schemes in the UI.
  if (!/^(https?:|mailto:|#|\/)/i.test(href)) return null;
  return {
    node: { type: "link", href, children: parseInline(label) },
    next: closeHref + 1,
  };
}

function takeHtmlU(src: string, i: number): { node: InlineNode; next: number } | null {
  const open = src.slice(i, i + 3).toLowerCase();
  if (open !== "<u>") return null;
  const closeIdx = src.toLowerCase().indexOf("</u>", i + 3);
  if (closeIdx < 0) return null;
  return {
    node: { type: "u", children: parseInline(src.slice(i + 3, closeIdx)) },
    next: closeIdx + 4,
  };
}

/** Parse inline markdown into a flat tree of InlineNodes. */
export function parseInline(src: string): InlineNode[] {
  const out: InlineNode[] = [];
  let i = 0;
  let textStart = 0;

  const flushText = (until: number) => {
    if (until > textStart) {
      out.push({ type: "text", value: src.slice(textStart, until) });
    }
  };

  while (i < src.length) {
    // Soft line breaks inside a paragraph.
    if (src[i] === "\n") {
      flushText(i);
      out.push({ type: "br" });
      i += 1;
      textStart = i;
      continue;
    }

    let hit: { node: InlineNode; next: number } | null = null;

    // Order matters: longer / more specific markers first.
    // Single * / _ use word boundaries so file_path and a*b stay plain text.
    hit =
      takeHtmlU(src, i) ??
      takeInlineCode(src, i) ??
      takeLink(src, i) ??
      takeDelimited(src, i, "**", "**", (c) => ({ type: "strong", children: c })) ??
      takeDelimited(src, i, "__", "__", (c) => ({ type: "strong", children: c })) ??
      takeDelimited(src, i, "~~", "~~", (c) => ({ type: "del", children: c })) ??
      takeDelimited(src, i, "++", "++", (c) => ({ type: "u", children: c })) ??
      takeDelimited(src, i, "*", "*", (c) => ({ type: "em", children: c }), true) ??
      takeDelimited(src, i, "_", "_", (c) => ({ type: "em", children: c }), true);

    if (hit) {
      flushText(i);
      out.push(hit.node);
      i = hit.next;
      textStart = i;
      continue;
    }

    i += 1;
  }

  flushText(src.length);
  return out;
}

function parseListItems(lines: string[], ordered: boolean): InlineNode[][] {
  const items: InlineNode[][] = [];
  const re = ordered ? /^\d+\.\s+(.*)$/ : /^[-*+]\s+(.*)$/;
  for (const line of lines) {
    const m = line.match(re);
    items.push(parseInline(m ? m[1]! : line));
  }
  return items;
}

/** Parse a full markdown string into block nodes. */
export function parseMarkdown(src: string): BlockNode[] {
  const blocks: BlockNode[] = [];
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Skip extra blank lines between blocks.
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Fenced code block.
    const fence = line.match(/^```([\w+-]*)\s*$/);
    if (fence) {
      const lang = fence[1] ?? "";
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1; // closing fence
      blocks.push({ type: "code_block", lang, value: body.join("\n") });
      continue;
    }

    // ATX headings.
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1]!.length as 1 | 2 | 3,
        children: parseInline(heading[2]!),
      });
      i += 1;
      continue;
    }

    // Blockquote (single-line and consecutive).
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        q.push(lines[i]!.replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "blockquote", children: parseInline(q.join("\n")) });
      continue;
    }

    // Unordered list.
    if (/^[-*+]\s+/.test(line)) {
      const itemLines: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i]!)) {
        itemLines.push(lines[i]!);
        i += 1;
      }
      blocks.push({ type: "list", ordered: false, items: parseListItems(itemLines, false) });
      continue;
    }

    // Ordered list.
    if (/^\d+\.\s+/.test(line)) {
      const itemLines: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i]!)) {
        itemLines.push(lines[i]!);
        i += 1;
      }
      blocks.push({ type: "list", ordered: true, items: parseListItems(itemLines, true) });
      continue;
    }

    // Paragraph: consecutive non-blank, non-special lines.
    const para: string[] = [];
    while (i < lines.length) {
      const L = lines[i]!;
      if (L.trim() === "") break;
      if (/^```/.test(L)) break;
      if (/^#{1,3}\s+/.test(L)) break;
      if (/^>\s?/.test(L)) break;
      if (/^[-*+]\s+/.test(L)) break;
      if (/^\d+\.\s+/.test(L)) break;
      para.push(L);
      i += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(para.join("\n")) });
  }

  return blocks;
}
