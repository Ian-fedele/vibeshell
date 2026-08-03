/**
 * Pure helpers for turning tool inputs/outputs into UI-friendly detail text
 * and clickable link lists (especially WebSearch / WebFetch).
 */

export interface ToolLink {
  url: string;
  title?: string;
}

const URL_RE = /https?:\/\/[^\s<>"'`)\]}]+/g;

/** Trim trailing punctuation often glued onto URLs in free text. */
function cleanUrl(raw: string): string {
  return raw.replace(/[.,;:!?)]+$/g, "");
}

/** Short one-line summary of a tool invocation from its input. */
export function summarizeToolInput(name: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;
  const str = (k: string): string =>
    typeof obj[k] === "string" ? (obj[k] as string) : "";

  switch (name) {
    case "WebSearch":
    case "web_search":
    case "WebSearchTool":
      return str("query") || str("q") || undefined;
    case "WebFetch":
    case "web_fetch":
    case "WebFetchTool":
      return str("url") || undefined;
    case "Read":
    case "read_file":
      return str("file_path") || str("path") || undefined;
    case "Write":
    case "write":
    case "Edit":
    case "search_replace":
      return str("file_path") || str("path") || undefined;
    case "Bash":
    case "run_terminal_command":
      return str("command") || undefined;
    case "Grep":
    case "grep":
      return str("pattern") || undefined;
    case "Glob":
    case "glob":
      return str("pattern") || undefined;
    default:
      break;
  }

  // Generic fallbacks common across tools.
  for (const key of ["query", "url", "file_path", "path", "command", "pattern"]) {
    const v = str(key);
    if (v) return v.length > 120 ? `${v.slice(0, 117)}…` : v;
  }
  return undefined;
}

function pushLink(out: ToolLink[], seen: Set<string>, url: string, title?: string): void {
  const cleaned = cleanUrl(url);
  if (!/^https?:\/\//i.test(cleaned)) return;
  if (seen.has(cleaned)) return;
  seen.add(cleaned);
  out.push(title ? { url: cleaned, title } : { url: cleaned });
}

function collectFromUnknown(
  value: unknown,
  out: ToolLink[],
  seen: Set<string>,
  depth = 0,
): void {
  if (value == null || depth > 6) return;

  if (typeof value === "string") {
    // Whole string is a URL, or scrape URLs from free text.
    if (/^https?:\/\//i.test(value.trim())) {
      pushLink(out, seen, value.trim());
      return;
    }
    const matches = value.match(URL_RE);
    if (matches) {
      for (const m of matches) pushLink(out, seen, m);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectFromUnknown(item, out, seen, depth + 1);
    return;
  }

  if (typeof value !== "object") return;
  const obj = value as Record<string, unknown>;

  // WebSearch hit shape: { title, url }
  if (typeof obj.url === "string") {
    pushLink(out, seen, obj.url, typeof obj.title === "string" ? obj.title : undefined);
  }

  // WebSearchOutput: { results: [ { content: [ {title,url} ] } | string ] }
  if (Array.isArray(obj.results)) {
    collectFromUnknown(obj.results, out, seen, depth + 1);
  }
  if (Array.isArray(obj.content)) {
    collectFromUnknown(obj.content, out, seen, depth + 1);
  }
  // Grok / generic: links, sources, citations
  for (const key of ["links", "sources", "citations", "urls"]) {
    if (key in obj) collectFromUnknown(obj[key], out, seen, depth + 1);
  }

  // Walk a few other nested objects (rawOutput wrappers).
  for (const key of ["rawOutput", "output", "data", "result"]) {
    if (key in obj && typeof obj[key] === "object") {
      collectFromUnknown(obj[key], out, seen, depth + 1);
    }
  }
}

/** Extract http(s) links from a tool's structured or text result. */
export function extractToolLinks(result: unknown): ToolLink[] {
  const out: ToolLink[] = [];
  const seen = new Set<string>();
  collectFromUnknown(result, out, seen);
  return out;
}

/** Prefer a stable display host for a URL chip. */
export function linkLabel(link: ToolLink): string {
  if (link.title?.trim()) return link.title.trim();
  try {
    const u = new URL(link.url);
    return u.hostname.replace(/^www\./, "") + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return link.url;
  }
}
