/**
 * Thin browser-WebSocket client for the engine sidecar. Queues commands sent
 * before the socket opens and flushes them on connect. Reconnects for as long
 * as the page is alive so a Vite reload or brief engine blip does not kill the
 * UI — engine sessions outlive the socket and reattach via sessions_snapshot.
 */
import type { ClientCommand, EngineEvent } from "./protocol";

// Defaults to loopback, which is what the Tauri shell and an SSH port-forward
// both want. Override with VITE_ENGINE_URL to point a browser-hosted UI at a
// remote engine (e.g. ws://your-mac:4517 over a tailnet).
const ENGINE_URL = import.meta.env.VITE_ENGINE_URL ?? "ws://localhost:4517";
const RETRY_MS = 500;
const MAX_RETRY_MS = 5_000;

export type ConnectionStatus = "connecting" | "open" | "closed";

export class EngineClient {
  private ws: WebSocket | null = null;
  private queue: ClientCommand[] = [];
  private retries = 0;
  private disposed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onEvent: (event: EngineEvent) => void,
    private readonly onStatus: (status: ConnectionStatus) => void,
  ) {}

  connect(): void {
    if (this.disposed) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Drop a half-open socket before opening another.
    if (this.ws) {
      const prev = this.ws;
      this.ws = null;
      prev.onopen = null;
      prev.onmessage = null;
      prev.onerror = null;
      prev.onclose = null;
      try {
        prev.close();
      } catch {
        // ignore
      }
    }

    this.onStatus("connecting");
    const ws = new WebSocket(ENGINE_URL);
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.retries = 0;
      this.onStatus("open");
      for (const cmd of this.queue) ws.send(JSON.stringify(cmd));
      this.queue = [];
    };
    ws.onmessage = (message) => {
      if (this.ws !== ws) return;
      try {
        this.onEvent(JSON.parse(message.data as string) as EngineEvent);
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.onStatus("closed");
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose follows; avoid double-scheduling
      try {
        ws.close();
      } catch {
        // ignore
      }
    };
  }

  /** Stop reconnecting (page unload / tests). */
  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
  }

  send(cmd: ClientCommand): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(cmd));
    } else {
      this.queue.push(cmd);
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    const delay = Math.min(RETRY_MS * 2 ** this.retries, MAX_RETRY_MS);
    this.retries += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
