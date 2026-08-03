/**
 * Interactive PTY terminals multiplexed alongside agent sessions.
 * Each terminal is a real shell (SHELL env or platform default) streaming
 * output over the engine WebSocket to an xterm.js pane in the UI.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { spawn, type IPty } from "node-pty";
import type { EngineEvent, TerminalInfo } from "./protocol.js";

export type { TerminalInfo };

export interface TerminalManagerOptions {
  onEvent: (event: EngineEvent) => void;
}

interface TerminalEntry {
  proc: IPty;
  cwd: string;
  /** Suppress double-close after exit. */
  closed: boolean;
}

function defaultShell(): string {
  if (process.platform === "win32") {
    return process.env.COMSPEC || "powershell.exe";
  }
  const fromEnv = process.env.SHELL;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  for (const candidate of ["/bin/zsh", "/bin/bash", "/bin/sh"]) {
    if (existsSync(candidate)) return candidate;
  }
  return "/bin/sh";
}

function resolveCwd(cwd: string): string {
  const raw = cwd.trim() || ".";
  if (raw === "~") return homedir();
  if (raw.startsWith("~/")) return resolve(homedir(), raw.slice(2));
  // Relative paths are relative to the engine process cwd (the project root).
  return resolve(raw);
}

export class TerminalManager {
  private readonly onEvent: (event: EngineEvent) => void;
  private readonly terminals = new Map<string, TerminalEntry>();
  private counter = 0;

  constructor(options: TerminalManagerOptions) {
    this.onEvent = options.onEvent;
  }

  create(opts: { requestId: string; cwd: string; cols?: number; rows?: number }): string {
    const terminalId = `term_${++this.counter}`;
    const cwd = resolveCwd(opts.cwd);
    const cols = clampSize(opts.cols ?? 80, 20, 500);
    const rows = clampSize(opts.rows ?? 24, 5, 200);
    const shell = defaultShell();

    let proc: IPty;
    try {
      proc = spawn(shell, [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          // Avoid pager hangs inside the embedded terminal.
          PAGER: process.env.PAGER || "cat",
          GIT_PAGER: process.env.GIT_PAGER || "cat",
        } as Record<string, string>,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.onEvent({
        type: "error",
        message: `failed to spawn terminal: ${message}`,
        requestId: opts.requestId,
      });
      // Don't rethrow — server route would double-emit the error.
      return terminalId;
    }

    const entry: TerminalEntry = { proc, cwd, closed: false };
    this.terminals.set(terminalId, entry);

    proc.onData((data) => {
      this.onEvent({ type: "terminal_output", terminalId, data });
    });

    proc.onExit(({ exitCode }) => {
      if (entry.closed) return;
      entry.closed = true;
      this.terminals.delete(terminalId);
      this.onEvent({
        type: "terminal_exit",
        terminalId,
        exitCode: typeof exitCode === "number" ? exitCode : null,
      });
    });

    this.onEvent({
      type: "terminal_created",
      requestId: opts.requestId,
      terminalId,
      cwd,
    });

    return terminalId;
  }

  write(terminalId: string, data: string): void {
    const entry = this.terminals.get(terminalId);
    if (!entry || entry.closed) {
      throw new Error(`No such terminal: ${terminalId}`);
    }
    entry.proc.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const entry = this.terminals.get(terminalId);
    if (!entry || entry.closed) {
      throw new Error(`No such terminal: ${terminalId}`);
    }
    entry.proc.resize(clampSize(cols, 20, 500), clampSize(rows, 5, 200));
  }

  close(terminalId: string): void {
    const entry = this.terminals.get(terminalId);
    if (!entry) return;
    if (entry.closed) {
      this.terminals.delete(terminalId);
      return;
    }
    entry.closed = true;
    try {
      // SIGTERM first; node-pty kill() sends SIGHUP/SIGKILL-style teardown.
      entry.proc.kill();
    } catch {
      // already dead
    }
    this.terminals.delete(terminalId);
    this.onEvent({ type: "terminal_exit", terminalId, exitCode: null });
  }

  list(): TerminalInfo[] {
    return [...this.terminals.entries()].map(([terminalId, entry]) => ({
      terminalId,
      cwd: entry.cwd,
    }));
  }

  /** Tear down every PTY (engine shutdown). */
  closeAll(): void {
    for (const id of [...this.terminals.keys()]) {
      this.close(id);
    }
  }
}

function clampSize(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
