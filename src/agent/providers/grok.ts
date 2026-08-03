/**
 * Grok provider (xAI).
 *
 * Two backends, same AgentSession surface:
 *  1. API — OpenAI-compatible chat completions + vibeshell tool loop
 *     (requires XAI_API_KEY from console.x.ai).
 *  2. CLI — headless `grok -p` streaming-json, using the user's existing
 *     Grok Build login (`grok login` / ~/.grok/auth.json).
 *
 * Prefers the API when a key is present; otherwise falls back to the CLI so
 * desktop users who already authenticated the CLI can chat without a separate
 * developer key.
 */
import { spawnSync } from "node:child_process";
import OpenAI from "openai";
import { envValue, loadVibeshellEnv } from "../env.js";
import { createInputPump } from "../inputPump.js";
import { buildPreview, isAutoAllowed } from "../permissions.js";
import { createGrokCliSession, resolveGrokBin } from "./grok-cli.js";
import { extractToolLinks, summarizeToolInput } from "../toolMeta.js";
import { GROK_EXECUTORS, GROK_TOOLS } from "./grok-tools.js";
import type {
  AgentEvent,
  AgentProvider,
  AgentSession,
  AgentSessionOptions,
  PermissionDecision,
} from "../types.js";

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const XAI_BASE_URL = "https://api.x.ai/v1";

export const GROK_CONFIG_HELP =
  "Grok is not configured. Set XAI_API_KEY (https://console.x.ai) in the environment " +
  "or a .env file, or install and authenticate the grok CLI (`curl -fsSL https://x.ai/cli/install.sh | bash` then `grok login`).";

function systemPrompt(cwd: string): string {
  return [
    `You are vibeshell, a coding agent working in the directory ${cwd}.`,
    "You have tools to read, search, edit files, and run bash commands.",
    "Use the tools to actually make the changes the user asks for rather than only describing them.",
    "When the task is done, give a brief summary of what you changed.",
  ].join(" ");
}

interface Pending {
  resolve: (decision: PermissionDecision) => void;
  toolName: string;
}

function grokCliReady(): boolean {
  const probe = spawnSync(resolveGrokBin(), ["--version"], {
    encoding: "utf8",
    timeout: 8000,
  });
  return !probe.error && probe.status === 0;
}

function createGrokApiSession(
  options: AgentSessionOptions,
  apiKey: string,
): AgentSession {
  const input = createInputPump<string>();
  const output = createInputPump<AgentEvent>();
  const client = new OpenAI({
    apiKey,
    baseURL: XAI_BASE_URL,
  });

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(options.cwd) },
  ];
  const pending = new Map<string, Pending>();
  const alwaysAllow = new Set<string>();
  let abort: AbortController | null = null;

  function gate(
    toolName: string,
    args: Record<string, unknown>,
    requestId: string,
  ): Promise<PermissionDecision> {
    if (isAutoAllowed(toolName) || alwaysAllow.has(toolName)) {
      return Promise.resolve({ type: "allow" });
    }
    return new Promise((resolve) => {
      pending.set(requestId, { resolve, toolName });
      output.push({
        type: "permission_request",
        requestId,
        toolName,
        preview: buildPreview(toolName, args),
      });
    });
  }

  async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
    const executor = GROK_EXECUTORS[name];
    if (!executor) return `Error: unknown tool ${name}`;
    try {
      return await executor(options.cwd, args);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  async function runTurn(): Promise<void> {
    abort = new AbortController();
    try {
      for (;;) {
        const stream = client.chat.completions.stream(
          { model: options.model, messages, tools: GROK_TOOLS },
          { signal: abort.signal },
        );
        stream.on("content", (delta) => {
          if (delta) output.push({ type: "text", text: delta });
        });
        const final = await stream.finalChatCompletion();
        const message = final.choices[0]?.message;
        if (!message) throw new Error("empty response from model");
        messages.push(message as ChatMessage);

        const toolCalls = message.tool_calls ?? [];
        if (toolCalls.length === 0) {
          output.push({
            type: "result",
            ok: true,
            durationMs: 0,
            tokens: final.usage?.total_tokens ?? 0,
          });
          return;
        }

        for (const call of toolCalls) {
          if (call.type !== "function") continue;
          const name = call.function.name;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
          } catch {
            // leave args empty; the executor will report a helpful error
          }
          output.push({
            type: "tool",
            name,
            id: call.id,
            detail: summarizeToolInput(name, args),
            status: "running",
          });
          const decision = await gate(name, args, call.id);
          if (decision.type === "allow_always") alwaysAllow.add(name);
          const result =
            decision.type === "deny"
              ? `Denied by user${decision.message ? `: ${decision.message}` : ""}`
              : await runTool(name, args);
          const links = extractToolLinks(result);
          // Also surface the target URL for fetch-like tools from the input.
          if (typeof args.url === "string") {
            const fromInput = extractToolLinks(args.url);
            for (const l of fromInput) {
              if (!links.some((x) => x.url === l.url)) links.push(l);
            }
          }
          output.push({
            type: "tool",
            name,
            id: call.id,
            status: decision.type === "deny" ? "error" : "done",
            ...(links.length ? { links } : {}),
          });
          messages.push({ role: "tool", tool_call_id: call.id, content: result });
        }
        // loop: let the model continue now that it has the tool results
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const reason = /api key|authentication|401|unauthorized/i.test(raw)
        ? `${raw} — check XAI_API_KEY (https://console.x.ai)`
        : raw;
      output.push({
        type: "result",
        ok: false,
        durationMs: 0,
        tokens: 0,
        reason,
      });
    } finally {
      abort = null;
    }
  }

  // Driver: one turn per user message, in order.
  void (async () => {
    try {
      for await (const text of input.iterable) {
        messages.push({ role: "user", content: text });
        await runTurn();
      }
    } finally {
      output.end();
    }
  })();

  return {
    send(text: string): void {
      input.push(text);
    },
    close(): void {
      input.end();
    },
    async interrupt(): Promise<void> {
      abort?.abort();
    },
    respondPermission(requestId: string, decision: PermissionDecision): void {
      const entry = pending.get(requestId);
      if (!entry) return;
      pending.delete(requestId);
      entry.resolve(decision);
    },
    events: output.iterable,
  };
}

function createGrokSession(options: AgentSessionOptions): AgentSession {
  loadVibeshellEnv();
  const apiKey = envValue("XAI_API_KEY");
  if (apiKey) return createGrokApiSession(options, apiKey);

  if (envValue("GROK_REQUIRE_API") === "1") {
    throw new Error(GROK_CONFIG_HELP);
  }

  if (!grokCliReady()) {
    throw new Error(GROK_CONFIG_HELP);
  }

  return createGrokCliSession(options);
}

export const grokProvider: AgentProvider = {
  id: "grok",
  createSession: createGrokSession,
};
