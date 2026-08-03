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
import { buildPreview, isAutoAllowed } from "../permissions.js";
import { extractToolLinks, summarizeToolInput } from "../toolMeta.js";
import type {
  AgentEvent,
  AgentProvider,
  AgentSession,
  AgentSessionOptions,
  PermissionDecision,
} from "../types.js";
import { formatHistoryForPrompt } from "../types.js";

/** Map one SDK message to zero or more normalized events. Pure — unit-tested. */
export function toAgentEvents(msg: SDKMessage): AgentEvent[] {
  switch (msg.type) {
    case "assistant": {
      const events: AgentEvent[] = [];
      for (const block of msg.message.content) {
        if (block.type === "text") events.push({ type: "text", text: block.text });
        else if (block.type === "tool_use") {
          const input =
            block.input && typeof block.input === "object"
              ? (block.input as Record<string, unknown>)
              : undefined;
          events.push({
            type: "tool",
            name: block.name,
            id: block.id,
            detail: summarizeToolInput(block.name, input),
            status: "running",
          });
        }
      }
      return events;
    }
    case "user": {
      // Tool results arrive as user messages with tool_result blocks + optional
      // structured tool_use_result (e.g. WebSearchOutput with title/url hits).
      const events: AgentEvent[] = [];
      const content = msg.message?.content;
      const links = extractToolLinks(msg.tool_use_result);

      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          const b = block as {
            type?: string;
            tool_use_id?: string;
            content?: unknown;
            is_error?: boolean;
          };
          if (b.type !== "tool_result") continue;
          const blockLinks = [
            ...links,
            ...extractToolLinks(b.content),
            ...extractToolLinks(msg.tool_use_result),
          ];
          // Dedupe by url
          const seen = new Set<string>();
          const unique = blockLinks.filter((l) => {
            if (seen.has(l.url)) return false;
            seen.add(l.url);
            return true;
          });
          events.push({
            type: "tool",
            id: b.tool_use_id,
            status: b.is_error ? "error" : "done",
            ...(unique.length ? { links: unique } : {}),
          });
        }
      } else if (links.length > 0) {
        events.push({ type: "tool", status: "done", links });
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
      // Conversation size after this turn, NOT tokens newly spent. The three
      // input fields partition the prompt the API actually received
      // (input_tokens is only the uncached remainder), and output is appended
      // to history, so the sum is what the model is holding.
      //
      // This is a gauge — the consumer must assign it, never accumulate it.
      // Summing it across turns re-counts the whole prefix once per turn, and
      // the prefix dominates: a trivial "say hi" session already carries ~12k
      // tokens of system prompt and tool schemas before any user content.
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

  const historyPrompt = formatHistoryForPrompt(options.history);

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
      // Rehydrate after UI/engine restart without replaying turns in the feed.
      ...(historyPrompt ? { appendSystemPrompt: historyPrompt } : {}),
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
