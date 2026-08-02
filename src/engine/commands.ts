/**
 * Custom slash commands. Each `<name>.md` under `.vibeshell/commands/` (or
 * `.claude/commands/`) in the working directory becomes `/name` — a prompt
 * template. When the user sends `/name args`, the engine expands the template
 * ($ARGUMENTS → the args) and sends the result to the agent. The pane still
 * shows what the user typed; only the agent sees the expansion.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Commands = Map<string, string>; // name -> prompt template

function stripFrontmatter(md: string): string {
  if (md.startsWith("---")) {
    const end = md.indexOf("\n---", 3);
    if (end !== -1) {
      const bodyStart = md.indexOf("\n", end + 1);
      return bodyStart !== -1 ? md.slice(bodyStart + 1).trimStart() : "";
    }
  }
  return md;
}

export function loadCommands(cwd: string): Commands {
  const commands: Commands = new Map();
  for (const base of [".vibeshell/commands", ".claude/commands"]) {
    const dir = join(cwd, base);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      const name = file.slice(0, -3);
      if (commands.has(name)) continue; // .vibeshell wins over .claude
      try {
        commands.set(name, stripFrontmatter(readFileSync(join(dir, file), "utf8")));
      } catch {
        // skip unreadable file
      }
    }
  }
  return commands;
}

/** If text invokes a known `/command`, return the expanded prompt; else null. */
export function expandCommand(text: string, commands: Commands): string | null {
  const match = /^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  const template = commands.get(match[1]!);
  if (template === undefined) return null;
  return template.replaceAll("$ARGUMENTS", match[2] ?? "").trim();
}
