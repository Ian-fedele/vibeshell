#!/usr/bin/env node
/**
 * Phase 0 spike: prove we can drive the Claude Agent SDK end-to-end.
 * Usage: vibeshell "explain this repo"
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

const DEFAULT_MODEL = "claude-opus-5";

async function main(): Promise<void> {
  const prompt = process.argv.slice(2).join(" ").trim();
  if (!prompt) {
    console.error('Usage: vibeshell "<prompt>"');
    process.exit(1);
  }

  const result = query({
    prompt,
    options: {
      model: DEFAULT_MODEL,
      cwd: process.cwd(),
    },
  });

  for await (const message of result) {
    switch (message.type) {
      case "assistant":
        for (const block of message.message.content) {
          if (block.type === "text") {
            process.stdout.write(block.text);
          } else if (block.type === "tool_use") {
            process.stderr.write(`\n[tool: ${block.name}]\n`);
          }
        }
        break;
      case "result":
        process.stdout.write("\n");
        if (message.subtype === "success") {
          process.stderr.write(
            `\n— done in ${(message.duration_ms / 1000).toFixed(1)}s, ` +
              `$${message.total_cost_usd.toFixed(4)}\n`,
          );
        } else {
          process.stderr.write(`\n— ended: ${message.subtype}\n`);
          process.exitCode = 1;
        }
        break;
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
