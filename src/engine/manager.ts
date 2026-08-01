/**
 * SessionManager — the engine's multi-session core. Owns N concurrent
 * AgentSessions and multiplexes their event streams into one sink, tagging
 * each event with its sessionId. The sidecar wraps this with a transport;
 * the front-end drives it with ClientCommands.
 */
import {
  createSession as defaultCreateSession,
  type AgentSession,
  type AgentSessionOptions,
} from "../agent/index.js";
import type { ClientCommand, EngineEvent } from "./protocol.js";

export type CreateSessionFn = (
  provider: string,
  options: AgentSessionOptions,
) => AgentSession;

export interface SessionManagerOptions {
  /** Sink for every engine → front-end event. */
  onEvent: (event: EngineEvent) => void;
  /** Override session creation (tests inject a fake provider). */
  createSession?: CreateSessionFn;
}

export class SessionManager {
  private readonly onEvent: (event: EngineEvent) => void;
  private readonly createSessionFn: CreateSessionFn;
  private readonly sessions = new Map<string, AgentSession>();
  private counter = 0;

  constructor(options: SessionManagerOptions) {
    this.onEvent = options.onEvent;
    this.createSessionFn = options.createSession ?? defaultCreateSession;
  }

  /** Route a client command; never throws — failures surface as error events. */
  handleCommand(cmd: ClientCommand): void {
    try {
      switch (cmd.type) {
        case "create_session": {
          const sessionId = this.create(cmd.provider, {
            model: cmd.model,
            cwd: cmd.cwd,
          });
          this.onEvent({ type: "session_created", requestId: cmd.requestId, sessionId });
          return;
        }
        case "send_message":
          this.require(cmd.sessionId).send(cmd.text);
          return;
        case "interrupt":
          this.require(cmd.sessionId)
            .interrupt()
            .catch((err: unknown) => this.emitError(this.message(err), cmd.sessionId));
          return;
        case "close_session":
          this.sessions.get(cmd.sessionId)?.close();
          return;
      }
    } catch (err) {
      const sessionId = "sessionId" in cmd ? cmd.sessionId : undefined;
      const requestId = "requestId" in cmd ? cmd.requestId : undefined;
      this.onEvent({ type: "error", message: this.message(err), sessionId, requestId });
    }
  }

  create(provider: string, options: AgentSessionOptions): string {
    const sessionId = `sess_${++this.counter}`;
    const session = this.createSessionFn(provider, options);
    this.sessions.set(sessionId, session);
    void this.pump(sessionId, session);
    return sessionId;
  }

  get sessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  private async pump(sessionId: string, session: AgentSession): Promise<void> {
    try {
      for await (const event of session.events) {
        this.onEvent({ type: "agent_event", sessionId, event });
      }
    } catch (err) {
      this.emitError(this.message(err), sessionId);
    } finally {
      this.sessions.delete(sessionId);
      this.onEvent({ type: "session_closed", sessionId });
    }
  }

  private require(sessionId: string): AgentSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No such session: ${sessionId}`);
    return session;
  }

  private emitError(message: string, sessionId?: string): void {
    this.onEvent({ type: "error", message, sessionId });
  }

  private message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
