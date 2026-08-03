/**
 * Wire contract with the engine sidecar. Mirrors src/engine/protocol.ts.
 */
export type ToolPreview =
  | { kind: "edit"; path: string; before: string; after: string }
  | { kind: "write"; path: string; content: string }
  | { kind: "bash"; command: string }
  | { kind: "other"; summary: string };

export type PermissionDecision =
  | { type: "allow" }
  | { type: "allow_always" }
  | { type: "deny"; message?: string };

export interface ToolLink {
  url: string;
  title?: string;
}

export type AgentEvent =
  | { type: "text"; text: string }
  | {
      type: "tool";
      name?: string;
      id?: string;
      detail?: string;
      status?: "running" | "done" | "error";
      links?: ToolLink[];
    }
  | { type: "permission_request"; requestId: string; toolName: string; title?: string; preview: ToolPreview }
  | { type: "result"; ok: boolean; durationMs: number; tokens: number; reason?: string };

export interface SessionInfo {
  sessionId: string;
  provider: string;
  model: string;
  cwd: string;
  branch?: string;
  canUndo: boolean;
}

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

export type HistoryTurn = { role: "user" | "assistant"; text: string };

export type ClientCommand =
  | {
      type: "create_session";
      requestId: string;
      provider: string;
      model: string;
      cwd: string;
      worktree?: boolean;
      history?: HistoryTurn[];
    }
  | { type: "send_message"; sessionId: string; text: string }
  | { type: "permission_response"; sessionId: string; requestId: string; decision: PermissionDecision }
  | { type: "undo"; sessionId: string }
  | { type: "interrupt"; sessionId: string }
  | { type: "close_session"; sessionId: string }
  | { type: "list_sessions" }
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
  | { type: "list_terminals" }
  | { type: "get_session_diff"; requestId: string; sessionId: string }
  | { type: "restore_files"; requestId: string; sessionId: string; paths: string[] }
  | { type: "list_worktrees"; requestId: string; cwd: string }
  | { type: "merge_worktree_branch"; requestId: string; cwd: string; branch: string }
  | {
      type: "discard_worktree_branch";
      requestId: string;
      cwd: string;
      branch: string;
      keepBranch?: boolean;
    };

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
