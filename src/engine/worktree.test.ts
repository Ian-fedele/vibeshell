import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorktree, removeWorktree } from "./worktree.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("worktree isolation", () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "vibeshell-wt-"));
    git(repo, "init");
    git(repo, "config", "user.email", "t@t.t");
    git(repo, "config", "user.name", "t");
    writeFileSync(join(repo, "a.txt"), "base\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-m", "init");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(join(repo, "..", ".vibeshell-worktrees"), { recursive: true, force: true });
  });

  it("creates an isolated worktree and preserves its work on the branch when removed", async () => {
    const wt = await createWorktree(repo, "sess_1");
    expect(wt).toBeTruthy();
    if (!wt) return;
    expect(wt.branch).toBe("vibeshell/sess_1");
    expect(existsSync(wt.path)).toBe(true);

    // Edit in the worktree; the main checkout is untouched.
    writeFileSync(join(wt.path, "a.txt"), "changed in worktree\n");
    writeFileSync(join(wt.path, "new.txt"), "new file\n");
    expect(git(repo, "show", "HEAD:a.txt")).toBe("base"); // main branch unchanged

    await removeWorktree(wt);

    // Worktree dir gone; the branch retains the committed work.
    expect(existsSync(wt.path)).toBe(false);
    expect(git(repo, "show", `${wt.branch}:a.txt`)).toBe("changed in worktree");
    expect(git(repo, "show", `${wt.branch}:new.txt`)).toBe("new file");
  });

  it("returns null for a non-git directory", async () => {
    const plain = mkdtempSync(join(tmpdir(), "vibeshell-plain-"));
    try {
      expect(await createWorktree(plain, "sess_1")).toBeNull();
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
