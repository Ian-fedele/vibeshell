#!/usr/bin/env node
/**
 * Engine sidecar. Exposes a process-scoped SessionManager over a local
 * WebSocket so the Tauri webview can drive sessions: it sends ClientCommand
 * JSON and receives EngineEvent JSON.
 *
 * Sessions outlive individual sockets. A Vite HMR reload or brief network
 * blip only detaches the event sink; reconnecting clients get a
 * sessions_snapshot plus any events buffered while nobody was connected.
 * Explicit close_session (or engine process exit) is what tears sessions down.
 *
 * Interactive terminal panes share the same transport via TerminalManager
 * (node-pty shells multiplexed as terminal_* events).
 */
import { WebSocketServer, type WebSocket } from "ws";
import { loadVibeshellEnv } from "./agent/env.js";
import { SessionManager } from "./engine/manager.js";
import { ensureNodePtyExecutable } from "./engine/fixNodePty.js";
import { TerminalManager } from "./engine/terminal.js";
import type { ClientCommand, EngineEvent } from "./engine/protocol.js";

// Load .env files before any provider reads process.env.
loadVibeshellEnv();
// pnpm often strips +x from node-pty's spawn-helper; fix before any PTY spawn.
ensureNodePtyExecutable();

const DEFAULT_PORT = 4517;

/**
 * Loopback by default: the engine has no authentication, so a session is
 * arbitrary code execution as the user. Bind to a routable interface only
 * behind a trusted network boundary (a tailnet, an SSH tunnel) — never a LAN
 * or the public internet.
 */
const DEFAULT_HOST = "127.0.0.1";

/** Events kept while no client is connected, replayed on the next attach. */
const MAX_BACKLOG = 500;

const TERMINAL_COMMANDS = new Set([
  "create_terminal",
  "terminal_input",
  "terminal_resize",
  "close_terminal",
  "list_terminals",
]);

/** Parse an incoming frame into a command, or null if it isn't a valid one. */
export function parseCommand(data: string): ClientCommand | null {
  try {
    const value: unknown = JSON.parse(data);
    if (
      value &&
      typeof value === "object" &&
      typeof (value as { type?: unknown }).type === "string"
    ) {
      return value as ClientCommand;
    }
    return null;
  } catch {
    return null;
  }
}

export function createEngineServer(
  port: number,
  host: string = DEFAULT_HOST,
): WebSocketServer {
  const wss = new WebSocketServer({ port, host });
  // Each sink carries a liveness probe so we can drop sockets that closed
  // without firing 'close' (half-open TCP, a killed remote client) instead of
  // treating them as an attached client and withholding the offline backlog.
  interface Sink {
    send: (event: EngineEvent) => void;
    isOpen: () => boolean;
  }
  const sinks = new Set<Sink>();
  const backlog: EngineEvent[] = [];

  const pruneDeadSinks = (): void => {
    for (const sink of sinks) if (!sink.isOpen()) sinks.delete(sink);
  };

  const broadcast = (event: EngineEvent): void => {
    pruneDeadSinks();
    // High-frequency PTY output shouldn't fill the offline backlog — only
    // keep structural events so a reconnect doesn't flood with stale bytes.
    const skipBacklog = event.type === "terminal_output";
    if (sinks.size === 0) {
      if (skipBacklog) return;
      backlog.push(event);
      if (backlog.length > MAX_BACKLOG) backlog.shift();
      return;
    }
    for (const sink of sinks) sink.send(event);
  };

  // One manager for the process — sessions survive socket reconnects.
  const manager = new SessionManager({ onEvent: broadcast });
  const terminals = new TerminalManager({ onEvent: broadcast });

  const routeCommand = (command: ClientCommand): void => {
    if (TERMINAL_COMMANDS.has(command.type)) {
      try {
        switch (command.type) {
          case "create_terminal":
            terminals.create({
              requestId: command.requestId,
              cwd: command.cwd,
              cols: command.cols,
              rows: command.rows,
            });
            return;
          case "terminal_input":
            terminals.write(command.terminalId, command.data);
            return;
          case "terminal_resize":
            terminals.resize(command.terminalId, command.cols, command.rows);
            return;
          case "close_terminal":
            terminals.close(command.terminalId);
            return;
          case "list_terminals":
            broadcast({ type: "terminals_snapshot", terminals: terminals.list() });
            return;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const requestId = "requestId" in command ? command.requestId : undefined;
        const terminalId = "terminalId" in command ? command.terminalId : undefined;
        broadcast({
          type: "error",
          message,
          requestId,
          // Surface terminal id in sessionId slot so UI routing still works
          // when the error is about an existing terminal.
          sessionId: terminalId,
        });
      }
      return;
    }
    manager.handleCommand(command);
  };

  wss.on("connection", (socket: WebSocket) => {
    const send = (event: EngineEvent): void => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
    };
    const sink: Sink = { send, isOpen: () => socket.readyState === socket.OPEN };

    // Drop any sinks whose socket already died so this attach sees an accurate
    // connected-count (and, if it was the last one, drains the backlog below).
    pruneDeadSinks();
    sinks.add(sink);
    // Reattach first, then catch the client up on anything that fired offline.
    send({ type: "sessions_snapshot", sessions: manager.listSessions() });
    send({ type: "terminals_snapshot", terminals: terminals.list() });
    if (backlog.length > 0) {
      for (const event of backlog) send(event);
      backlog.length = 0;
    }

    socket.on("message", (data) => {
      const command = parseCommand(data.toString());
      if (!command) {
        send({ type: "error", message: "invalid command frame" });
        return;
      }
      routeCommand(command);
    });

    socket.on("close", () => {
      sinks.delete(sink);
      // Leave sessions/terminals running so a reloaded UI can reattach.
    });
  });

  return wss;
}

// Run as a process unless imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.VIBESHELL_PORT ?? DEFAULT_PORT);
  const host = process.env.VIBESHELL_HOST ?? DEFAULT_HOST;
  createEngineServer(port, host);
  console.error(`[vibeshell engine] listening on ws://${host}:${port}`);
  if (host !== DEFAULT_HOST && host !== "localhost") {
    console.error(
      `[vibeshell engine] WARNING: bound to ${host} (not loopback). The engine ` +
        `has no authentication — anyone who can reach this port can run commands ` +
        `as you. Ensure only a trusted network can route to it.`,
    );
  }
}
