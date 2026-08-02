/**
 * Tool set for non-Claude providers (the Claude Agent SDK supplies its own).
 * Tool names and argument shapes match the Claude side (Read/Write/Edit/Bash/
 * LS/Glob/Grep with file_path, old_string/new_string, content, command) so the
 * shared permission logic (isAutoAllowed, buildPreview) applies unchanged.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  existsSync,
  globSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type OpenAI from "openai";

const exec = promisify(execFile);
const MAX_OUTPUT = 60_000;

function resolvePath(cwd: string, p: string): string {
  return isAbsolute(p) ? p : join(cwd, p);
}

function cap(text: string): string {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n… [truncated]` : text;
}

export type ToolExecutor = (
  cwd: string,
  args: Record<string, unknown>,
) => Promise<string>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export const GROK_EXECUTORS: Record<string, ToolExecutor> = {
  async Read(cwd, args) {
    return cap(readFileSync(resolvePath(cwd, str(args.file_path)), "utf8"));
  },

  async Write(cwd, args) {
    const path = resolvePath(cwd, str(args.file_path));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, str(args.content));
    return `Wrote ${str(args.file_path)}`;
  },

  async Edit(cwd, args) {
    const path = resolvePath(cwd, str(args.file_path));
    const oldStr = str(args.old_string);
    const content = readFileSync(path, "utf8");
    const count = oldStr === "" ? 0 : content.split(oldStr).length - 1;
    if (count === 0) return `Error: old_string not found in ${str(args.file_path)}`;
    if (count > 1)
      return `Error: old_string is not unique (${count} matches) in ${str(args.file_path)}`;
    writeFileSync(path, content.replace(oldStr, str(args.new_string)));
    return `Edited ${str(args.file_path)}`;
  },

  async Bash(cwd, args) {
    try {
      const { stdout, stderr } = await exec("bash", ["-c", str(args.command)], {
        cwd,
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      return cap([stdout, stderr].filter(Boolean).join("\n")) || "(no output)";
    } catch (err) {
      const e = err as {
        stdout?: string;
        stderr?: string;
        code?: number;
        message?: string;
      };
      return cap(
        [e.stdout, e.stderr, `(exit ${e.code ?? "?"})`].filter(Boolean).join("\n") ||
          e.message ||
          "command failed",
      );
    }
  },

  async LS(cwd, args) {
    const path = resolvePath(cwd, str(args.path) || ".");
    const entries = readdirSync(path, { withFileTypes: true });
    return (
      entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join("\n") ||
      "(empty)"
    );
  },

  async Glob(cwd, args) {
    const matches = globSync(str(args.pattern) || "**/*", { cwd });
    return matches.slice(0, 500).join("\n") || "(no matches)";
  },

  async Grep(cwd, args) {
    const pattern = str(args.pattern);
    if (!pattern) return "Error: pattern is required";
    const re = new RegExp(pattern);
    const root = str(args.path) || ".";
    const base = resolvePath(cwd, root);
    const files = existsSync(base) ? globSync("**/*", { cwd: base }).slice(0, 2000) : [];
    const hits: string[] = [];
    for (const rel of files) {
      const full = join(base, rel);
      let content: string;
      try {
        content = readFileSync(full, "utf8");
      } catch {
        continue; // directory or binary
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]!)) {
          hits.push(`${rel}:${i + 1}:${lines[i]!.slice(0, 200)}`);
          if (hits.length >= 200) return cap(hits.join("\n"));
        }
      }
    }
    return hits.length ? cap(hits.join("\n")) : "(no matches)";
  },
};

export const GROK_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "Read",
      description: "Read a file from the filesystem.",
      parameters: {
        type: "object",
        properties: { file_path: { type: "string", description: "Path to the file" } },
        required: ["file_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "Write",
      description: "Write (create or overwrite) a file.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string" },
          content: { type: "string" },
        },
        required: ["file_path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "Edit",
      description: "Replace a unique occurrence of old_string with new_string in a file.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
        },
        required: ["file_path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "Bash",
      description: "Run a bash command in the working directory.",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "LS",
      description: "List the entries of a directory.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Directory (default '.')" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "Glob",
      description: "Find files matching a glob pattern.",
      parameters: {
        type: "object",
        properties: { pattern: { type: "string", description: "e.g. src/**/*.ts" } },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "Grep",
      description: "Search files for a regular expression.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string", description: "Directory to search (default '.')" },
        },
        required: ["pattern"],
      },
    },
  },
];
