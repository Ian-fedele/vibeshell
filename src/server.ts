#!/usr/bin/env node
/**
 * Engine sidecar. Exposes the SessionManager over a local WebSocket so the
 * Tauri webview can drive sessions: it sends ClientCommand JSON and receives
 * EngineEvent JSON. One SessionManager per connection (a window's sessions).
 */
import { WebSocketServer, type WebSocket } from "ws";
import { SessionManager } from "./engine/manager.js";
import type { ClientCommand, EngineEvent } from "./engine/protocol.js";

const DEFAULT_PORT = 4517;

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

export function createEngineServer(port: number): WebSocketServer {
  const wss = new WebSocketServer({ port });

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
  createEngineServer(port);
  console.error(`[vibeshell engine] listening on ws://localhost:${port}`);
}
