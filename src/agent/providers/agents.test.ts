import { describe, expect, it, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgents, parseAgentFile } from "./agents.js";

describe("subagent loading", () => {
  it("parses frontmatter (description, tools, model) and prompt body", () => {
    const agent = parseAgentFile(
      "---\ndescription: Reviews code for bugs\ntools: Read, Grep, Glob\nmodel: sonnet\n---\nYou are a careful reviewer.\n",
    );
    expect(agent).toEqual({
      description: "Reviews code for bugs",
      tools: ["Read", "Grep", "Glob"],
      model: "sonnet",
      prompt: "You are a careful reviewer.",
    });
  });

  it("rejects a file missing description or body", () => {
    expect(parseAgentFile("no frontmatter here")).toBeNull();
    expect(parseAgentFile("---\ntools: Read\n---\nbody")).toBeNull(); // no description
    expect(parseAgentFile("---\ndescription: x\n---\n")).toBeNull(); // no body
  });

  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("loads agents from .vibeshell/agents and returns undefined when none", () => {
    const dir = mkdtempSync(join(tmpdir(), "vibeshell-agents-"));
    dirs.push(dir);
    expect(loadAgents(dir)).toBeUndefined();

    const agentsDir = join(dir, ".vibeshell", "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, "reviewer.md"),
      "---\ndescription: Reviews\n---\nBe thorough.",
    );
    expect(loadAgents(dir)).toEqual({
      reviewer: { description: "Reviews", prompt: "Be thorough." },
    });
  });
});
