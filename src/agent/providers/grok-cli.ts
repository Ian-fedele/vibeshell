/**
 * Grok Build CLI backend. Used when XAI_API_KEY is not set but the `grok`
 * binary is authenticated (e.g. via `grok login`). Spawns headless
 * `grok -p` with streaming-json, maps events into AgentEvent, and resumes the
 * CLI session across turns so multi-turn chat works.
 *
 * Tools run under the CLI with --always-approve (vibeshell's approval UI is
 * for the API tool loop). Isolate worktrees + undo still apply to the cwd.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createInputPump } from "../inputPump.js";
import { extractToolLinks, summarizeToolInput } from "../toolMeta.js";
import type {
  AgentEvent,
  AgentSession,
  AgentSessionOptions,
  PermissionDecision,
} from "../types.js";
import { formatHistoryForPrompt } from "../types.js";

export function resolveGrokBin(): string {
  if (process.env.GROK_BIN?.trim()) return process.env.GROK_BIN.trim();
  // Common install location when PATH is minimal (GUI/IDE launches).
  const candidate = join(homedir(), ".grok", "bin", "grok");
  if (existsSync(candidate)) return candidate;
  return "grok";
}

/** True when `grok --version` exits 0 (binary on PATH / GROK_BIN). */
export async function isGrokCliAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(resolveGrokBin(), ["--version"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

/** Pure mapper for one streaming-json line → zero or more AgentEvents. */
export function mapGrokStreamLine(line: string): {
  events: AgentEvent[];
  sessionId?: string;
  tokens?: number;
} {
  const trimmed = line.trim();
  if (!trimmed) return { events: [] };

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return { events: [] };
  }
  if (!data || typeof data !== "object") return { events: [] };
  const row = data as Record<string, unknown>;
  const type = row.type;

  if (type === "text" && typeof row.data === "string" && row.data) {
    return { events: [{ type: "text", text: row.data }] };
  }

  if (type === "tool_call") {
    const name =
      (typeof row.toolName === "string" && row.toolName) ||
      (typeof row.title === "string" && row.title) ||
      "tool";
    const id =
      typeof row.toolCallId === "string"
        ? row.toolCallId
        : typeof row.id === "string"
          ? row.id
          : undefined;
    const rawInput = row.rawInput ?? row.input;
    const detail = summarizeToolInput(name, rawInput);
    const status =
      row.status === "completed" || row.status === "done"
        ? "done"
        : row.status === "failed" || row.status === "error"
          ? "error"
          : "running";
    const links = extractToolLinks(row.rawOutput ?? row.output ?? rawInput);
    return {
      events: [
        {
          type: "tool",
          name,
          id,
          detail,
          status,
          ...(links.length ? { links } : {}),
        },
      ],
    };
  }

  if (type === "tool_call_update") {
    const id =
      typeof row.toolCallId === "string"
        ? row.toolCallId
        : typeof row.id === "string"
          ? row.id
          : undefined;
    const name =
      (typeof row.toolName === "string" && row.toolName) ||
      (typeof row.title === "string" && row.title) ||
      undefined;
    const status =
      row.status === "completed" || row.status === "done"
        ? "done"
        : row.status === "failed" || row.status === "error"
          ? "error"
          : row.status === "in_progress"
            ? "running"
            : "done";
    const links = extractToolLinks(row.rawOutput ?? row.output ?? row.content);
    return {
      events: [
        {
          type: "tool",
          name,
          id,
          status,
          ...(links.length ? { links } : {}),
        },
      ],
    };
  }

  if (type === "end") {
    const sessionId = typeof row.sessionId === "string" ? row.sessionId : undefined;
    const usage = row.usage as { total_tokens?: number } | undefined;
    const tokens = typeof usage?.total_tokens === "number" ? usage.total_tokens : 0;
    return {
      events: [{ type: "result", ok: true, durationMs: 0, tokens }],
      sessionId,
      tokens: usage?.total_tokens,
    };
  }

  if (type === "error") {
    const message = typeof row.message === "string" ? row.message : "grok CLI error";
    return {
      events: [{ type: "result", ok: false, durationMs: 0, tokens: 0, reason: message }],
    };
  }

  return { events: [] };
}

function runGrokPrompt(options: {
  prompt: string;
  model: string;
  cwd: string;
  resumeId: string | null;
  /** Injected once on the first turn when we cannot resume a CLI session. */
  rules?: string;
  signal: AbortSignal;
  onLine: (line: string) => void;
}): Promise<{ code: number; stderr: string }> {
  const args = [
    "-p",
    options.prompt,
    "-m",
    options.model,
    "--cwd",
    options.cwd,
    "--output-format",
    "streaming-json",
    "--always-approve",
    "--no-auto-update",
  ];
  if (options.resumeId) {
    args.push("--resume", options.resumeId);
  } else if (options.rules) {
    // Headless --rules appends to the system prompt (first turn only).
    args.push("--rules", options.rules);
  }

  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(resolveGrokBin(), args, {
        env: { ...process.env, GROK_DISABLE_AUTOUPDATER: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      reject(err);
      return;
    }

    const onAbort = (): void => {
      child.kill("SIGTERM");
    };
    if (options.signal.aborted) {
      onAbort();
    } else {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    if (!child.stdout || !child.stderr) {
      options.signal.removeEventListener("abort", onAbort);
      reject(new Error("grok CLI spawn failed: missing stdio pipes"));
      return;
    }

    const stdout = createInterface({ input: child.stdout });
    stdout.on("line", (line) => options.onLine(line));

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      options.signal.removeEventListener("abort", onAbort);
      reject(err);
    });

    child.on("close", (code) => {
      options.signal.removeEventListener("abort", onAbort);
      resolve({ code: code ?? 1, stderr: stderr.trim() });
    });
  });
}

export function createGrokCliSession(options: AgentSessionOptions): AgentSession {
  const input = createInputPump<string>();
  const output = createInputPump<AgentEvent>();
  let resumeId: string | null = null;
  let abort: AbortController | null = null;
  const restoreRules = formatHistoryForPrompt(options.history);
  let injectRestore = !!restoreRules;

  async function runTurn(text: string): Promise<void> {
    abort = new AbortController();
    let sawResult = false;
    let sawText = false;
    const rules = injectRestore ? restoreRules : undefined;
    injectRestore = false;

    try {
      const { code, stderr } = await runGrokPrompt({
        prompt: text,
        model: options.model,
        cwd: options.cwd,
        resumeId,
        rules,
        signal: abort.signal,
        onLine(line) {
          const mapped = mapGrokStreamLine(line);
          if (mapped.sessionId) resumeId = mapped.sessionId;
          for (const event of mapped.events) {
            if (event.type === "text") sawText = true;
            if (event.type === "result") sawResult = true;
            output.push(event);
          }
        },
      });

      if (abort.signal.aborted) {
        if (!sawResult) {
          output.push({
            type: "result",
            ok: false,
            durationMs: 0,
            tokens: 0,
            reason: "interrupted",
          });
        }
        return;
      }

      if (code !== 0 && !sawResult) {
        const reason =
          stderr ||
          (code === 127
            ? `grok CLI not found (set GROK_BIN or install via https://x.ai/cli)`
            : `grok CLI exited with code ${code}`);
        output.push({
          type: "result",
          ok: false,
          durationMs: 0,
          tokens: 0,
          reason,
        });
        return;
      }

      // Streaming finished without an end/error frame — still close the turn.
      if (!sawResult) {
        output.push({
          type: "result",
          ok: sawText,
          durationMs: 0,
          tokens: 0,
          reason: sawText ? undefined : stderr || "empty response from grok CLI",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const reason =
        (err as NodeJS.ErrnoException)?.code === "ENOENT"
          ? `grok CLI not found (set GROK_BIN or install via https://x.ai/cli)`
          : message;
      output.push({
        type: "result",
        ok: false,
        durationMs: 0,
        tokens: 0,
        reason,
      });
    } finally {
      abort = null;
    }
  }

  void (async () => {
    try {
      for await (const text of input.iterable) {
        await runTurn(text);
      }
    } finally {
      output.end();
    }
  })();

  return {
    send(text: string): void {
      input.push(text);
    },
    close(): void {
      abort?.abort();
      input.end();
    },
    async interrupt(): Promise<void> {
      abort?.abort();
    },
    respondPermission(_requestId: string, _decision: PermissionDecision): void {
      // CLI path auto-approves tools; nothing to bridge.
    },
    events: output.iterable,
  };
}
