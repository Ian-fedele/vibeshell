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
import { gitCheckpointer, type Checkpointer } from "./checkpoint.js";
import { loadCommands, expandCommand, type Commands } from "./commands.js";
import { createWorktree, removeWorktree, type Worktree } from "./worktree.js";
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
  /** Override the working-tree checkpointer (tests inject a fake). */
  checkpointer?: Checkpointer;
}

interface SessionEntry {
  session: AgentSession;
  cwd: string;
  checkpoint: string | null;
  commands: Commands;
  worktree?: Worktree;
}

export class SessionManager {
  private readonly onEvent: (event: EngineEvent) => void;
  private readonly createSessionFn: CreateSessionFn;
  private readonly checkpointer: Checkpointer;
  private readonly sessions = new Map<string, SessionEntry>();
  private counter = 0;

  constructor(options: SessionManagerOptions) {
    this.onEvent = options.onEvent;
    this.createSessionFn = options.createSession ?? defaultCreateSession;
    this.checkpointer = options.checkpointer ?? gitCheckpointer;
  }

  /** Route a client command; never throws — failures surface as error events. */
  handleCommand(cmd: ClientCommand): void {
    try {
      switch (cmd.type) {
        case "create_session": {
          if (cmd.worktree) {
            void this.createIsolated(cmd);
            return;
          }
          const sessionId = this.create(cmd.provider, {
            model: cmd.model,
            cwd: cmd.cwd,
          });
          this.onEvent({ type: "session_created", requestId: cmd.requestId, sessionId });
          return;
        }
        case "send_message": {
          const entry = this.require(cmd.sessionId);
          // Snapshot the working tree before the turn. Best-effort and
          // concurrent: model latency far exceeds snapshot time, so it lands
          // before the agent's first edit.
          void this.checkpoint(cmd.sessionId, entry);
          // Expand a "/command" into its prompt template (agent sees the
          // expansion; the pane already shows what the user typed).
          entry.session.send(expandCommand(cmd.text, entry.commands) ?? cmd.text);
          return;
        }
        case "permission_response":
          this.require(cmd.sessionId).session.respondPermission(
            cmd.requestId,
            cmd.decision,
          );
          return;
        case "undo":
          void this.undo(cmd.sessionId);
          return;
        case "interrupt":
          this.require(cmd.sessionId)
            .session.interrupt()
            .catch((err: unknown) => this.emitError(this.message(err), cmd.sessionId));
          return;
        case "close_session":
          this.sessions.get(cmd.sessionId)?.session.close();
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
    this.register(sessionId, provider, options);
    return sessionId;
  }

  private register(
    sessionId: string,
    provider: string,
    options: AgentSessionOptions,
    worktree?: Worktree,
  ): void {
    const session = this.createSessionFn(provider, options);
    this.sessions.set(sessionId, {
      session,
      cwd: options.cwd,
      checkpoint: null,
      commands: loadCommands(options.cwd),
      worktree,
    });
    void this.pump(sessionId, session);
  }

  /** Create a session in an isolated git worktree (async: git setup first). */
  private async createIsolated(
    cmd: Extract<ClientCommand, { type: "create_session" }>,
  ): Promise<void> {
    const sessionId = `sess_${++this.counter}`;
    let cwd = cmd.cwd;
    let worktree: Worktree | undefined;
    try {
      worktree = (await createWorktree(cmd.cwd, sessionId)) ?? undefined;
      if (worktree) cwd = worktree.path;
    } catch (err) {
      this.emitError(`worktree setup failed: ${this.message(err)}`);
    }
    this.register(sessionId, cmd.provider, { model: cmd.model, cwd }, worktree);
    this.onEvent({
      type: "session_created",
      requestId: cmd.requestId,
      sessionId,
      branch: worktree?.branch,
    });
  }

  private async checkpoint(sessionId: string, entry: SessionEntry): Promise<void> {
    try {
      entry.checkpoint = await this.checkpointer.snapshot(entry.cwd);
    } catch {
      entry.checkpoint = null;
    }
    this.onEvent({ type: "checkpoint", sessionId, available: entry.checkpoint !== null });
  }

  private async undo(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return this.emitError(`No such session: ${sessionId}`, sessionId);
    if (!entry.checkpoint) return this.emitError("Nothing to undo", sessionId);
    try {
      await this.checkpointer.restore(entry.cwd, entry.checkpoint);
      entry.checkpoint = null;
      this.onEvent({ type: "checkpoint", sessionId, available: false });
    } catch (err) {
      this.emitError(this.message(err), sessionId);
    }
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
      const worktree = this.sessions.get(sessionId)?.worktree;
      this.sessions.delete(sessionId);
      this.onEvent({ type: "session_closed", sessionId });
      // Preserve the isolated session's work to its branch, then tear down.
      if (worktree) void removeWorktree(worktree);
    }
  }

  private require(sessionId: string): SessionEntry {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error(`No such session: ${sessionId}`);
    return entry;
  }

  private emitError(message: string, sessionId?: string): void {
    this.onEvent({ type: "error", message, sessionId });
  }

  private message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
