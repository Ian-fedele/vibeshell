/**
 * Loads MCP server definitions from a repo-level `.mcp.json` (the Claude Code
 * convention: `{ "mcpServers": { name: config, ... } }`). We load it explicitly
 * and pass it to the SDK, rather than letting the SDK read filesystem settings,
 * so permission isolation (settingSources: []) stays intact.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Returns the `mcpServers` record from `<cwd>/.mcp.json`, or undefined. */
export function loadMcpServers(cwd: string): Record<string, unknown> | undefined {
  const path = join(cwd, ".mcp.json");
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object" && "mcpServers" in parsed) {
      const servers = (parsed as { mcpServers: unknown }).mcpServers;
      if (servers && typeof servers === "object" && Object.keys(servers).length > 0) {
        return servers as Record<string, unknown>;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}
