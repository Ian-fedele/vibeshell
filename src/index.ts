#!/usr/bin/env node
/**
 * Phase 1.1: a multi-turn REPL over a persistent Agent SDK session.
 * Type a prompt, watch the turn stream, get the prompt back. `/exit` quits.
 */
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createSession, type SDKMessage } from "./agent/session.js";

const DEFAULT_MODEL = "claude-opus-5";

const dim = (s: string): string => `\x1b[2m${s}\x1b[0m`;

/** Render one SDK message. Returns true when the turn is complete. */
function render(msg: SDKMessage, cost: { usd: number }): boolean {
  switch (msg.type) {
    case "assistant":
      for (const block of msg.message.content) {
        if (block.type === "text") stdout.write(block.text);
        else if (block.type === "tool_use") stdout.write(dim(`\n[${block.name}] `));
      }
      return false;
    case "result": {
      stdout.write("\n");
      if (msg.subtype === "success") {
        cost.usd += msg.total_cost_usd;
        stdout.write(
          dim(
            `— ${(msg.duration_ms / 1000).toFixed(1)}s · ` +
              `$${msg.total_cost_usd.toFixed(4)} this turn · ` +
              `$${cost.usd.toFixed(4)} session`,
          ) + "\n",
        );
      } else {
        stdout.write(dim(`— turn ended: ${msg.subtype}`) + "\n");
      }
      return true;
    }
    default:
      return false;
  }
}

async function main(): Promise<void> {
  const session = createSession({ model: DEFAULT_MODEL, cwd: process.cwd() });
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const cost = { usd: 0 };

  // EOF (Ctrl+D / end of piped input) closes readline; treat it as /exit.
  let closed = false;
  rl.once("close", () => {
    closed = true;
  });

  stdout.write(`vibeshell · ${DEFAULT_MODEL} · type /exit to quit\n\n`);

  /**
   * Prompt until the user submits a real turn (returns true, a turn is now
   * running) or asks to quit (returns false). Blank lines just re-prompt so
   * they never leave the message stream waiting for a result that won't come.
   */
  const promptForTurn = async (): Promise<boolean> => {
    for (;;) {
      if (closed) {
        session.close();
        return false;
      }
      let line: string;
      try {
        line = (await rl.question("\x1b[1m› \x1b[0m")).trim();
      } catch {
        // rl closed while awaiting input (EOF mid-turn).
        session.close();
        return false;
      }
      if (line === "/exit" || line === "/quit") {
        session.close();
        return false;
      }
      if (line.length > 0) {
        session.send(line);
        return true;
      }
    }
  };

  if (!(await promptForTurn())) {
    rl.close();
    return;
  }

  for await (const msg of session.messages) {
    if (render(msg, cost)) {
      if (!(await promptForTurn())) break;
    }
  }

  rl.close();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
