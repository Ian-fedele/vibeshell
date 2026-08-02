import { describe, expect, it, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandCommand, loadCommands, type Commands } from "./commands.js";

describe("commands", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const repoWith = (files: Record<string, string>): string => {
    const dir = mkdtempSync(join(tmpdir(), "vibeshell-cmd-"));
    dirs.push(dir);
    const cmdDir = join(dir, ".vibeshell", "commands");
    mkdirSync(cmdDir, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(cmdDir, name), body);
    }
    return dir;
  };

  it("loads commands and strips frontmatter", () => {
    const dir = repoWith({
      "review.md": "---\ndescription: review code\n---\nReview this: $ARGUMENTS",
    });
    const commands = loadCommands(dir);
    expect(commands.get("review")).toBe("Review this: $ARGUMENTS");
  });

  it("expands a known command, substituting $ARGUMENTS", () => {
    const commands: Commands = new Map([["review", "Review this file: $ARGUMENTS"]]);
    expect(expandCommand("/review src/app.ts", commands)).toBe(
      "Review this file: src/app.ts",
    );
    expect(expandCommand("/review", commands)).toBe("Review this file:");
  });

  it("returns null for unknown commands or plain text", () => {
    const commands: Commands = new Map([["review", "x"]]);
    expect(expandCommand("/nope arg", commands)).toBeNull();
    expect(expandCommand("just a message", commands)).toBeNull();
  });
});
