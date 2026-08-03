/**
 * Thin browser-WebSocket client for the engine sidecar. Queues commands sent
 * before the socket opens and flushes them on connect.
 */
import type { ClientCommand, EngineEvent } from "./protocol";

// Defaults to loopback, which is what the Tauri shell and an SSH port-forward
// both want. Override with VITE_ENGINE_URL to point a browser-hosted UI at a
// remote engine (e.g. ws://your-mac:4517 over a tailnet).
const ENGINE_URL = import.meta.env.VITE_ENGINE_URL ?? "ws://localhost:4517";
const RETRY_MS = 500;
const MAX_RETRIES = 20;

export type ConnectionStatus = "connecting" | "open" | "closed";

export class EngineClient {
  private ws: WebSocket | null = null;
  private queue: ClientCommand[] = [];
  private opened = false;
  private retries = 0;

  constructor(
    private readonly onEvent: (event: EngineEvent) => void,
    private readonly onStatus: (status: ConnectionStatus) => void,
  ) {}

  connect(): void {
    this.onStatus("connecting");
    const ws = new WebSocket(ENGINE_URL);
    this.ws = ws;
    ws.onopen = () => {
      this.opened = true;
      this.retries = 0;
      this.onStatus("open");
      for (const cmd of this.queue) ws.send(JSON.stringify(cmd));
      this.queue = [];
    };
    ws.onmessage = (message) => {
      try {
        this.onEvent(JSON.parse(message.data as string) as EngineEvent);
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      this.onStatus("closed");
      // Retry only until the first successful connection — this covers the
      // dev-startup race where the app opens before the engine is listening.
      if (!this.opened && this.retries < MAX_RETRIES) {
        this.retries += 1;
        setTimeout(() => this.connect(), RETRY_MS);
      }
    };
    ws.onerror = () => ws.close();
  }

  send(cmd: ClientCommand): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(cmd));
    } else {
      this.queue.push(cmd);
    }
  }
}
