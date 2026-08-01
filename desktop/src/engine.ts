/**
 * Thin browser-WebSocket client for the engine sidecar. Queues commands sent
 * before the socket opens and flushes them on connect.
 */
import type { ClientCommand, EngineEvent } from "./protocol";

const ENGINE_URL = "ws://localhost:4517";

export type ConnectionStatus = "connecting" | "open" | "closed";

export class EngineClient {
  private ws: WebSocket | null = null;
  private queue: ClientCommand[] = [];

  constructor(
    private readonly onEvent: (event: EngineEvent) => void,
    private readonly onStatus: (status: ConnectionStatus) => void,
  ) {}

  connect(): void {
    this.onStatus("connecting");
    const ws = new WebSocket(ENGINE_URL);
    this.ws = ws;
    ws.onopen = () => {
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
    ws.onclose = () => this.onStatus("closed");
  }

  send(cmd: ClientCommand): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(cmd));
    } else {
      this.queue.push(cmd);
    }
  }
}
