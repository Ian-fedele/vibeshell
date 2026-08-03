/**
 * Shared permission logic used by every provider so the approval UI behaves
 * identically regardless of the model backend. Tool names and input shapes are
 * normalized across providers (file_path, old_string/new_string, content,
 * command), so the same read-only allowlist and preview builder apply.
 */
import { resolve, sep } from "node:path";
import type { ToolPreview } from "./types.js";

/** Tools that only read state — auto-approved, so they never prompt. */
const READ_ONLY_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "NotebookRead",
  "TodoWrite",
]);

/** True when `p` resolves to `cwd` itself or a path within it. */
function insideCwd(cwd: string, p: string): boolean {
  const root = resolve(cwd);
  const abs = resolve(root, p);
  return abs === root || abs.startsWith(root + sep);
}

/**
 * Path/glob arguments a read-only tool would touch, so auto-allow can confirm
 * they stay inside the project. Names are normalized across providers.
 */
function readTargets(toolName: string, input: Record<string, unknown>): string[] {
  const s = (k: string): string =>
    typeof input[k] === "string" ? (input[k] as string) : "";
  switch (toolName) {
    case "Read":
      return [s("file_path"), s("path")].filter(Boolean);
    case "LS":
    case "Grep":
      return [s("path")].filter(Boolean);
    case "Glob":
      return [s("path"), s("pattern")].filter(Boolean);
    case "NotebookRead":
      return [s("notebook_path"), s("file_path")].filter(Boolean);
    default:
      return [];
  }
}

/**
 * A read-only tool is auto-approved only when its path arguments stay inside
 * the session cwd. A read of an absolute or ../-escaping path (e.g. ~/.ssh, a
 * sibling repo's .env) is NOT auto-allowed — it falls through to a normal
 * approval prompt so the user sees secrets leaving the project. When input/cwd
 * aren't supplied (e.g. name-only checks in tests), falls back to the allowlist.
 */
export function isAutoAllowed(
  toolName: string,
  input?: Record<string, unknown>,
  cwd?: string,
): boolean {
  if (!READ_ONLY_TOOLS.has(toolName)) return false;
  if (input && cwd) {
    // insideCwd handles absolute targets too: an absolute path that genuinely
    // resolves within cwd stays auto-allowed; one outside falls through.
    for (const target of readTargets(toolName, input)) {
      if (!insideCwd(cwd, target)) return false;
    }
  }
  return true;
}

/** Build an approval preview from a tool call. Pure — unit-tested. */
export function buildPreview(
  toolName: string,
  input: Record<string, unknown>,
): ToolPreview {
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  switch (toolName) {
    case "Edit":
      return {
        kind: "edit",
        path: str(input.file_path),
        before: str(input.old_string),
        after: str(input.new_string),
      };
    case "Write":
      return { kind: "write", path: str(input.file_path), content: str(input.content) };
    case "Bash":
      return { kind: "bash", command: str(input.command) };
    default:
      return {
        kind: "other",
        summary: `${toolName} ${JSON.stringify(input).slice(0, 200)}`,
      };
  }
}
