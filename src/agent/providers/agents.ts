/**
 * Subagent definitions. Each `<name>.md` under `.vibeshell/agents/` (or
 * `.claude/agents/`) is a subagent the main agent can delegate to: YAML-ish
 * frontmatter (description, optional tools/model) plus a prompt body. Loaded
 * explicitly and passed to the SDK's `agents` option (settingSources stays []).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface LoadedAgent {
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
}

function extractFrontmatter(
  md: string,
): { fields: Record<string, string>; body: string } | null {
  if (!md.startsWith("---")) return null;
  const end = md.indexOf("\n---", 3);
  if (end === -1) return null;
  const fmBlock = md.slice(md.indexOf("\n", 3) + 1, end);
  const bodyStart = md.indexOf("\n", end + 1);
  const body = bodyStart !== -1 ? md.slice(bodyStart + 1) : "";
  const fields: Record<string, string> = {};
  for (const line of fmBlock.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) fields[key] = value;
  }
  return { fields, body };
}

export function parseAgentFile(md: string): LoadedAgent | null {
  const parsed = extractFrontmatter(md);
  if (!parsed) return null;
  const description = parsed.fields.description;
  const prompt = parsed.body.trim();
  if (!description || !prompt) return null;
  const agent: LoadedAgent = { description, prompt };
  if (parsed.fields.tools) {
    agent.tools = parsed.fields.tools
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  if (parsed.fields.model) agent.model = parsed.fields.model;
  return agent;
}

export function loadAgents(cwd: string): Record<string, LoadedAgent> | undefined {
  const agents: Record<string, LoadedAgent> = {};
  for (const base of [".vibeshell/agents", ".claude/agents"]) {
    const dir = join(cwd, base);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      const name = file.slice(0, -3);
      if (agents[name]) continue; // .vibeshell wins over .claude
      try {
        const parsed = parseAgentFile(readFileSync(join(dir, file), "utf8"));
        if (parsed) agents[name] = parsed;
      } catch {
        // skip unreadable/invalid file
      }
    }
  }
  return Object.keys(agents).length > 0 ? agents : undefined;
}
