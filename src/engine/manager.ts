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
import { getWorkingTreeDiff, restorePaths } from "./diff.js";
import { discardBranch, listVibeshellWorktrees, mergeBranch } from "./worktreeOps.js";
import { createWorktree, removeWorktree, type Worktree } from "./worktree.js";
import type { ClientCommand, EngineEvent, SessionInfo } from "./protocol.js";

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
  provider: string;
  model: string;
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
            history: cmd.history,
          });
          this.onEvent({ type: "session_created", requestId: cmd.requestId, sessionId });
          return;
        }
        case "send_message": {
          const entry = this.require(cmd.sessionId);
          void this.sendWithCheckpoint(cmd.sessionId, entry, cmd.text);
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
        case "list_sessions":
          this.onEvent({ type: "sessions_snapshot", sessions: this.listSessions() });
          return;
        case "get_session_diff":
          void this.emitSessionDiff(cmd.requestId, cmd.sessionId);
          return;
        case "restore_files":
          void this.restoreFiles(cmd.requestId, cmd.sessionId, cmd.paths);
          return;
        case "list_worktrees":
          void this.emitWorktrees(cmd.requestId, cmd.cwd);
          return;
        case "merge_worktree_branch":
          void this.mergeWorktree(cmd.requestId, cmd.cwd, cmd.branch);
          return;
        case "discard_worktree_branch":
          void this.discardWorktree(cmd.requestId, cmd.cwd, cmd.branch, cmd.keepBranch);
          return;
        // Terminal commands are routed by the server, not here.
        case "create_terminal":
        case "terminal_input":
        case "terminal_resize":
        case "close_terminal":
        case "list_terminals":
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

  /** Snapshot of live sessions for clients reattaching after a disconnect. */
  listSessions(): SessionInfo[] {
    return [...this.sessions.entries()].map(([sessionId, entry]) => ({
      sessionId,
      provider: entry.provider,
      model: entry.model,
      cwd: entry.cwd,
      branch: entry.worktree?.branch,
      canUndo: entry.checkpoint !== null,
    }));
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
      provider,
      model: options.model,
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
      // null = not a git repo: nothing to isolate, so fall back to cmd.cwd.
      worktree = (await createWorktree(cmd.cwd, sessionId)) ?? undefined;
      if (worktree) cwd = worktree.path;
    } catch (err) {
      // A real setup failure must NOT silently drop the agent onto the user's
      // main checkout — that defeats the whole point of isolate. Fail the
      // create instead so the UI surfaces it (keyed by requestId = paneId).
      this.onEvent({
        type: "error",
        message: `worktree setup failed: ${this.message(err)}`,
        requestId: cmd.requestId,
      });
      return;
    }
    this.register(
      sessionId,
      cmd.provider,
      { model: cmd.model, cwd, history: cmd.history },
      worktree,
    );
    this.onEvent({
      type: "session_created",
      requestId: cmd.requestId,
      sessionId,
      branch: worktree?.branch,
    });
  }

  /**
   * Snapshot the working tree, THEN dispatch the turn. The checkpoint must
   * complete before the agent can touch a file, or the snapshot races the edit
   * and undo restores a half-applied state.
   */
  private async sendWithCheckpoint(
    sessionId: string,
    entry: SessionEntry,
    text: string,
  ): Promise<void> {
    await this.checkpoint(sessionId, entry);
    entry.session.send(expandCommand(text, entry.commands) ?? text);
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

  private async emitSessionDiff(requestId: string, sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      this.onEvent({
        type: "error",
        message: `No such session: ${sessionId}`,
        sessionId,
        requestId,
      });
      return;
    }
    try {
      const files = await getWorkingTreeDiff(entry.cwd);
      this.onEvent({
        type: "session_diff",
        requestId,
        sessionId,
        files,
        canRestoreFromCheckpoint: entry.checkpoint !== null,
      });
    } catch (err) {
      this.onEvent({
        type: "error",
        message: this.message(err),
        sessionId,
        requestId,
      });
    }
  }

  private async restoreFiles(
    requestId: string,
    sessionId: string,
    paths: string[],
  ): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      this.onEvent({
        type: "error",
        message: `No such session: ${sessionId}`,
        sessionId,
        requestId,
      });
      return;
    }
    try {
      const result = await restorePaths(entry.cwd, paths, entry.checkpoint);
      this.onEvent({
        type: "restore_files_result",
        requestId,
        sessionId,
        restored: result.restored,
        removed: result.removed,
        errors: result.errors,
      });
    } catch (err) {
      this.onEvent({
        type: "error",
        message: this.message(err),
        sessionId,
        requestId,
      });
    }
  }

  private async emitWorktrees(requestId: string, cwd: string): Promise<void> {
    try {
      const items = await listVibeshellWorktrees(cwd);
      this.onEvent({ type: "worktrees", requestId, items });
    } catch (err) {
      this.onEvent({ type: "error", message: this.message(err), requestId });
    }
  }

  private async mergeWorktree(
    requestId: string,
    cwd: string,
    branch: string,
  ): Promise<void> {
    try {
      const message = await mergeBranch(cwd, branch);
      this.onEvent({ type: "worktree_action_result", requestId, ok: true, message });
      const items = await listVibeshellWorktrees(cwd);
      this.onEvent({ type: "worktrees", requestId: `${requestId}:list`, items });
    } catch (err) {
      this.onEvent({
        type: "worktree_action_result",
        requestId,
        ok: false,
        message: this.message(err),
      });
    }
  }

  private async discardWorktree(
    requestId: string,
    cwd: string,
    branch: string,
    keepBranch?: boolean,
  ): Promise<void> {
    try {
      const message = await discardBranch(cwd, branch, {
        deleteBranch: !keepBranch,
        preserve: false,
      });
      this.onEvent({ type: "worktree_action_result", requestId, ok: true, message });
      const items = await listVibeshellWorktrees(cwd);
      this.onEvent({ type: "worktrees", requestId: `${requestId}:list`, items });
    } catch (err) {
      this.onEvent({
        type: "worktree_action_result",
        requestId,
        ok: false,
        message: this.message(err),
      });
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
      // Preserve the isolated session's work to its branch, then tear down. If
      // the work couldn't be committed the worktree is left in place — surface
      // that instead of dropping an unhandled rejection.
      if (worktree) {
        removeWorktree(worktree).catch((err: unknown) =>
          this.emitError(this.message(err), sessionId),
        );
      }
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
