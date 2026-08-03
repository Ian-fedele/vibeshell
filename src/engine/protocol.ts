/**
 * IPC contract between the front-end (webview) and the engine (Node sidecar).
 * Transport-agnostic — the same messages flow over a WebSocket, stdio, or an
 * in-process callback. Session ids are engine-assigned; requests correlate via
 * requestId until the id is known.
 */
import type { AgentEvent, PermissionDecision } from "../agent/index.js";

/** Live session metadata for reconnect / reattach. */
export interface SessionInfo {
  sessionId: string;
  provider: string;
  model: string;
  cwd: string;
  branch?: string;
  canUndo: boolean;
}

/** Prior chat turns for rehydrating a session after restart. */
export type HistoryTurn = { role: "user" | "assistant"; text: string };

/** Live interactive terminal metadata for reconnect / reattach. */
export interface TerminalInfo {
  terminalId: string;
  cwd: string;
}

export type DiffStatus = "modified" | "added" | "deleted" | "renamed" | "unknown";

export interface DiffFile {
  path: string;
  status: DiffStatus;
  patch: string;
  additions: number;
  deletions: number;
}

export interface WorktreeListItem {
  branch: string;
  path: string | null;
  isMain: boolean;
  commits?: number;
  dirty?: boolean;
}

/** Front-end → engine. */
export type ClientCommand =
  | {
      type: "create_session";
      requestId: string;
      provider: string;
      model: string;
      cwd: string;
      /** Run this session in an isolated git worktree + branch. */
      worktree?: boolean;
      /** Seed agent context when recreating after engine/UI restart. */
      history?: HistoryTurn[];
    }
  | { type: "send_message"; sessionId: string; text: string }
  | {
      type: "permission_response";
      sessionId: string;
      requestId: string;
      decision: PermissionDecision;
    }
  | { type: "undo"; sessionId: string }
  | { type: "interrupt"; sessionId: string }
  | { type: "close_session"; sessionId: string }
  /** Ask the engine to re-emit the live session list (also sent on connect). */
  | { type: "list_sessions" }
  /** Spawn an interactive shell PTY (xterm pane). */
  | {
      type: "create_terminal";
      requestId: string;
      cwd: string;
      cols?: number;
      rows?: number;
    }
  | { type: "terminal_input"; terminalId: string; data: string }
  | { type: "terminal_resize"; terminalId: string; cols: number; rows: number }
  | { type: "close_terminal"; terminalId: string }
  /** Re-emit live terminals (also sent on connect). */
  | { type: "list_terminals" }
  /** Working-tree diff for a session (vs HEAD). */
  | { type: "get_session_diff"; requestId: string; sessionId: string }
  /** Restore files from turn checkpoint (or HEAD). */
  | {
      type: "restore_files";
      requestId: string;
      sessionId: string;
      paths: string[];
    }
  /** List vibeshell/* isolate branches for a repo. */
  | { type: "list_worktrees"; requestId: string; cwd: string }
  | { type: "merge_worktree_branch"; requestId: string; cwd: string; branch: string }
  | {
      type: "discard_worktree_branch";
      requestId: string;
      cwd: string;
      branch: string;
      /** Keep branch tip commit (default false = delete branch). */
      keepBranch?: boolean;
    };

/** Engine → front-end. */
export type EngineEvent =
  | { type: "session_created"; requestId: string; sessionId: string; branch?: string }
  | { type: "agent_event"; sessionId: string; event: AgentEvent }
  | { type: "checkpoint"; sessionId: string; available: boolean }
  | { type: "session_closed"; sessionId: string }
  | { type: "sessions_snapshot"; sessions: SessionInfo[] }
  | { type: "terminal_created"; requestId: string; terminalId: string; cwd?: string }
  | { type: "terminal_output"; terminalId: string; data: string }
  | { type: "terminal_exit"; terminalId: string; exitCode: number | null }
  | { type: "terminals_snapshot"; terminals: TerminalInfo[] }
  | {
      type: "session_diff";
      requestId: string;
      sessionId: string;
      files: DiffFile[];
      canRestoreFromCheckpoint: boolean;
    }
  | {
      type: "restore_files_result";
      requestId: string;
      sessionId: string;
      restored: string[];
      removed: string[];
      errors: string[];
    }
  | { type: "worktrees"; requestId: string; items: WorktreeListItem[] }
  | { type: "worktree_action_result"; requestId: string; ok: boolean; message: string }
  | { type: "error"; message: string; sessionId?: string; requestId?: string };
