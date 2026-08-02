/**
 * Shared permission logic used by every provider so the approval UI behaves
 * identically regardless of the model backend. Tool names and input shapes are
 * normalized across providers (file_path, old_string/new_string, content,
 * command), so the same read-only allowlist and preview builder apply.
 */
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

export function isAutoAllowed(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
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
