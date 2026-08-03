import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock node-pty before importing TerminalManager.
const writes: string[] = [];
const resizes: Array<{ cols: number; rows: number }> = [];
let onDataCb: ((d: string) => void) | null = null;
let onExitCb: ((e: { exitCode: number; signal?: number }) => void) | null = null;
let killed = false;

vi.mock("node-pty", () => ({
  spawn: vi.fn(() => ({
    write: (d: string) => writes.push(d),
    resize: (cols: number, rows: number) => resizes.push({ cols, rows }),
    kill: () => {
      killed = true;
      onExitCb?.({ exitCode: 0 });
    },
    onData: (cb: (d: string) => void) => {
      onDataCb = cb;
    },
    onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => {
      onExitCb = cb;
    },
  })),
}));

import { TerminalManager } from "./terminal.js";
import type { EngineEvent } from "./protocol.js";

describe("TerminalManager", () => {
  beforeEach(() => {
    writes.length = 0;
    resizes.length = 0;
    onDataCb = null;
    onExitCb = null;
    killed = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a terminal, streams output, and closes", () => {
    const events: EngineEvent[] = [];
    const mgr = new TerminalManager({ onEvent: (e) => events.push(e) });

    const id = mgr.create({ requestId: "pane_1", cwd: ".", cols: 100, rows: 30 });
    expect(id).toMatch(/^term_/);
    expect(events[0]).toMatchObject({
      type: "terminal_created",
      requestId: "pane_1",
      terminalId: id,
    });

    onDataCb?.("hello\r\n");
    expect(events).toContainEqual({
      type: "terminal_output",
      terminalId: id,
      data: "hello\r\n",
    });

    mgr.write(id, "ls\n");
    expect(writes).toEqual(["ls\n"]);

    mgr.resize(id, 120, 40);
    expect(resizes).toEqual([{ cols: 120, rows: 40 }]);

    mgr.close(id);
    expect(killed).toBe(true);
    expect(events.some((e) => e.type === "terminal_exit" && e.terminalId === id)).toBe(
      true,
    );
    expect(mgr.list()).toEqual([]);
  });
});
