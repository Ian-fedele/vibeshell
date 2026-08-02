import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GROK_EXECUTORS } from "./grok-tools.js";

describe("grok tool executors", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vibeshell-tools-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("Read returns file contents", async () => {
    writeFileSync(join(dir, "a.txt"), "hello\n");
    expect(await GROK_EXECUTORS.Read!(dir, { file_path: "a.txt" })).toBe("hello\n");
  });

  it("Write creates a file (with parent dirs)", async () => {
    await GROK_EXECUTORS.Write!(dir, { file_path: "sub/b.txt", content: "hi" });
    expect(readFileSync(join(dir, "sub/b.txt"), "utf8")).toBe("hi");
  });

  it("Edit replaces a unique occurrence and reports non-unique/missing", async () => {
    writeFileSync(join(dir, "c.txt"), "one two three\n");
    expect(
      await GROK_EXECUTORS.Edit!(dir, {
        file_path: "c.txt",
        old_string: "two",
        new_string: "2",
      }),
    ).toMatch(/Edited/);
    expect(readFileSync(join(dir, "c.txt"), "utf8")).toBe("one 2 three\n");

    writeFileSync(join(dir, "d.txt"), "x x x");
    expect(
      await GROK_EXECUTORS.Edit!(dir, {
        file_path: "d.txt",
        old_string: "x",
        new_string: "y",
      }),
    ).toMatch(/not unique/);
    expect(
      await GROK_EXECUTORS.Edit!(dir, {
        file_path: "d.txt",
        old_string: "zzz",
        new_string: "y",
      }),
    ).toMatch(/not found/);
  });

  it("Bash runs a command in cwd", async () => {
    const out = await GROK_EXECUTORS.Bash!(dir, { command: "echo grok-bash-ok" });
    expect(out).toContain("grok-bash-ok");
  });

  it("LS, Glob, and Grep work", async () => {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "app.ts"), "const secret = 42;\n");
    writeFileSync(join(dir, "readme.md"), "# hi\n");

    expect(await GROK_EXECUTORS.LS!(dir, {})).toContain("src/");
    expect(await GROK_EXECUTORS.Glob!(dir, { pattern: "**/*.ts" })).toContain(
      "src/app.ts",
    );
    expect(await GROK_EXECUTORS.Grep!(dir, { pattern: "secret" })).toContain(
      "src/app.ts:1:",
    );
  });
});
