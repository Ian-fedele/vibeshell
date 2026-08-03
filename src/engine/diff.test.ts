import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { getWorkingTreeDiff, isInsideCwd, restorePaths } from "./diff.js";

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

  it("restorePaths refuses to touch a path outside the project", async () => {
    const outside = mkdtempSync(join(tmpdir(), "vibeshell-outside-"));
    const sentinel = join(outside, "keep.txt");
    writeFileSync(sentinel, "important\n");
    try {
      // ../-style traversal out of the repo
      const rel = relative(dir, sentinel);
      const r1 = await restorePaths(dir, [rel], null);
      expect(r1.errors.some((e) => e.includes("outside the project"))).toBe(true);
      expect(r1.removed).not.toContain(rel);

      // absolute path
      const r2 = await restorePaths(dir, [sentinel], null);
      expect(r2.errors).toHaveLength(1);
      expect(r2.restored).toHaveLength(0);
      expect(r2.removed).toHaveLength(0);

      // the outside file was never deleted
      expect(existsSync(sentinel)).toBe(true);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("isInsideCwd accepts nested paths and rejects escapes", () => {
    expect(isInsideCwd(dir, "a.txt")).toBe(true);
    expect(isInsideCwd(dir, "sub/b.txt")).toBe(true);
    expect(isInsideCwd(dir, "../evil.txt")).toBe(false);
    expect(isInsideCwd(dir, "/etc/passwd")).toBe(false);
    expect(isInsideCwd(dir, ".")).toBe(false); // cwd itself is not "inside"
  });
});
