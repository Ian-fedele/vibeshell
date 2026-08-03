#!/usr/bin/env node
/**
 * Engine sidecar. Exposes the SessionManager over a local WebSocket so the
 * Tauri webview can drive sessions: it sends ClientCommand JSON and receives
 * EngineEvent JSON. One SessionManager per connection (a window's sessions).
 */
import { WebSocketServer, type WebSocket } from "ws";
import { loadVibeshellEnv } from "./agent/env.js";
import { SessionManager } from "./engine/manager.js";
import type { ClientCommand, EngineEvent } from "./engine/protocol.js";

// Load .env files before any provider reads process.env.
loadVibeshellEnv();

const DEFAULT_PORT = 4517;

/**
 * Loopback by default: the engine hands every connection a SessionManager with
 * no authentication, so a session is arbitrary code execution as the user. Bind
 * to a routable interface only behind a trusted network boundary (a tailnet, an
 * SSH tunnel) — never a LAN or the public internet.
 */
const DEFAULT_HOST = "127.0.0.1";

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

  wss.on("connection", (socket: WebSocket) => {
    const send = (event: EngineEvent): void => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
    };
    const manager = new SessionManager({ onEvent: send });

    socket.on("message", (data) => {
      const command = parseCommand(data.toString());
      if (!command) {
        send({ type: "error", message: "invalid command frame" });
        return;
      }
      manager.handleCommand(command);
    });

    socket.on("close", () => {
      for (const sessionId of manager.sessionIds) {
        manager.handleCommand({ type: "close_session", sessionId });
      }
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
