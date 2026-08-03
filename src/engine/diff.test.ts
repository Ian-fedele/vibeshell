import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getWorkingTreeDiff, restorePaths } from "./diff.js";

function git(cwd: string, ...args: string[]) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

describe("working tree diff", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vibeshell-diff-"));
    git(dir, "init");
    git(dir, "config", "user.email", "test@example.com");
    git(dir, "config", "user.name", "test");
    writeFileSync(join(dir, "a.txt"), "hello\n");
    git(dir, "add", "a.txt");
    git(dir, "commit", "-m", "init");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists modified files with patch stats", async () => {
    writeFileSync(join(dir, "a.txt"), "hello\nworld\n");
    const files = await getWorkingTreeDiff(dir);
    expect(files.some((f) => f.path === "a.txt" && f.status === "modified")).toBe(true);
    const a = files.find((f) => f.path === "a.txt")!;
    expect(a.additions).toBeGreaterThan(0);
    expect(a.patch).toContain("+world");
  });

  it("lists untracked files as added", async () => {
    writeFileSync(join(dir, "b.txt"), "new\n");
    const files = await getWorkingTreeDiff(dir);
    expect(files.some((f) => f.path === "b.txt" && f.status === "added")).toBe(true);
  });

  it("restorePaths resets a modified file from HEAD", async () => {
    writeFileSync(join(dir, "a.txt"), "changed\n");
    const result = await restorePaths(dir, ["a.txt"], null);
    expect(result.restored).toContain("a.txt");
    const files = await getWorkingTreeDiff(dir);
    expect(files.find((f) => f.path === "a.txt")).toBeUndefined();
  });

  it("restorePaths removes an untracked file", async () => {
    writeFileSync(join(dir, "c.txt"), "tmp\n");
    const result = await restorePaths(dir, ["c.txt"], null);
    expect(result.removed).toContain("c.txt");
  });
});
