/**
 * Claude provider — the only module that imports the Claude Agent SDK.
 * Translates the SDK's message stream into our normalized AgentEvent stream,
 * and bridges the SDK's canUseTool permission callback to permission_request
 * events + respondPermission().
 */
import {
  query,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type PermissionResult,
  type PermissionUpdate,
  type McpServerConfig,
  type AgentDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import { createInputPump } from "../inputPump.js";
import { loadMcpServers } from "./mcp.js";
import { loadAgents } from "./agents.js";
import type {
  AgentEvent,
  AgentProvider,
  AgentSession,
  AgentSessionOptions,
  PermissionDecision,
  ToolPreview,
} from "../types.js";

/** Map one SDK message to zero or more normalized events. Pure — unit-tested. */
export function toAgentEvents(msg: SDKMessage): AgentEvent[] {
  switch (msg.type) {
    case "assistant": {
      const events: AgentEvent[] = [];
      for (const block of msg.message.content) {
        if (block.type === "text") events.push({ type: "text", text: block.text });
        else if (block.type === "tool_use")
          events.push({ type: "tool", name: block.name });
      }
      return events;
    }
    case "result": {
      if (msg.subtype !== "success") {
        return [
          { type: "result", ok: false, durationMs: 0, tokens: 0, reason: msg.subtype },
        ];
      }
      const u = msg.usage;
      const tokens =
        u.input_tokens +
        u.output_tokens +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0);
      return [{ type: "result", ok: true, durationMs: msg.duration_ms, tokens }];
    }
    default:
      return [];
  }
}

/** Build an approval preview from a tool call. Pure — unit-tested. */
export function buildPreview(
  toolName: string,
  input: Record<string, unknown>,
): ToolPreview {
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  switch (toolName) {
    case "Edit":
      return {
        kind: "edit",
        path: str(input.file_path),
        before: str(input.old_string),
        after: str(input.new_string),
      };
    case "Write":
      return { kind: "write", path: str(input.file_path), content: str(input.content) };
    case "Bash":
      return { kind: "bash", command: str(input.command) };
    default:
      return {
        kind: "other",
        summary: `${toolName} ${JSON.stringify(input).slice(0, 200)}`,
      };
  }
}

/** Tools that only read state — auto-approved, so they never prompt. */
const READ_ONLY_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "NotebookRead",
  "TodoWrite",
]);

export function isAutoAllowed(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}

interface Pending {
  resolve: (result: PermissionResult) => void;
  suggestions?: PermissionUpdate[];
}

function createClaudeSession(options: AgentSessionOptions): AgentSession {
  const input = createInputPump<SDKUserMessage>();
  const output = createInputPump<AgentEvent>();
  const pending = new Map<string, Pending>();
  const mcpServers = loadMcpServers(options.cwd) as
    Record<string, McpServerConfig> | undefined;
  const agents = loadAgents(options.cwd) as Record<string, AgentDefinition> | undefined;

  const q: Query = query({
    prompt: input.iterable,
    options: {
      model: options.model,
      cwd: options.cwd,
      // Isolate from the user's ~/.claude settings so our approval UI is the
      // only gate; "default" mode routes gated tools through canUseTool.
      settingSources: [],
      permissionMode: "default",
      // MCP servers from a repo-level .mcp.json, loaded explicitly (see mcp.ts).
      ...(mcpServers ? { mcpServers } : {}),
      // Subagents from .vibeshell/agents/*.md (see agents.ts).
      ...(agents ? { agents } : {}),
      canUseTool: (toolName, toolInput, opts) => {
        if (isAutoAllowed(toolName)) {
          return Promise.resolve<PermissionResult>({ behavior: "allow" });
        }
        return new Promise<PermissionResult>((resolve) => {
          pending.set(opts.toolUseID, { resolve, suggestions: opts.suggestions });
          output.push({
            type: "permission_request",
            requestId: opts.toolUseID,
            toolName,
            title: opts.title,
            preview: buildPreview(toolName, toolInput),
          });
        });
      },
    },
  });

  // Drive the SDK message stream into the output pump.
  void (async () => {
    try {
      for await (const msg of q) {
        for (const event of toAgentEvents(msg)) output.push(event);
      }
    } catch (err) {
      output.push({
        type: "result",
        ok: false,
        durationMs: 0,
        tokens: 0,
        reason: err instanceof Error ? err.message : String(err),
      });
    } finally {
      output.end();
    }
  })();

  return {
    send(text: string): void {
      input.push({
        type: "user",
        message: { role: "user", content: text },
        parent_tool_use_id: null,
      });
    },
    close(): void {
      input.end();
    },
    async interrupt(): Promise<void> {
      await q.interrupt();
    },
    respondPermission(requestId: string, decision: PermissionDecision): void {
      const entry = pending.get(requestId);
      if (!entry) return;
      pending.delete(requestId);
      if (decision.type === "deny") {
        entry.resolve({
          behavior: "deny",
          message: decision.message ?? "Denied by user.",
        });
      } else if (decision.type === "allow_always") {
        entry.resolve({ behavior: "allow", updatedPermissions: entry.suggestions });
      } else {
        entry.resolve({ behavior: "allow" });
      }
    },
    events: output.iterable,
  };
}

export const claudeProvider: AgentProvider = {
  id: "claude",
  createSession: createClaudeSession,
};
