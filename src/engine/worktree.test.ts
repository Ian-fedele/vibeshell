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

  it("preserves work even when git has no configured user identity", async () => {
    // A repo with NO local identity, and global/system identity hidden — the
    // unconfigured-machine case. Without removeWorktree supplying its own -c
    // identity the commit fails and the staged work is discarded on --force.
    const saved = {
      global: process.env.GIT_CONFIG_GLOBAL,
      system: process.env.GIT_CONFIG_SYSTEM,
    };
    process.env.GIT_CONFIG_GLOBAL = "/dev/null";
    process.env.GIT_CONFIG_SYSTEM = "/dev/null";
    const bare = mkdtempSync(join(tmpdir(), "vibeshell-noid-"));
    try {
      git(bare, "init");
      writeFileSync(join(bare, "a.txt"), "base\n");
      git(bare, "add", "-A");
      // Only the seed commit gets an inline identity; the repo config stays empty.
      git(
        bare,
        "-c",
        "user.name=seed",
        "-c",
        "user.email=seed@x",
        "commit",
        "-m",
        "init",
      );

      const wt = await createWorktree(bare, "sess_noid");
      expect(wt).toBeTruthy();
      if (!wt) return;
      writeFileSync(join(wt.path, "a.txt"), "edited without identity\n");

      await removeWorktree(wt);

      expect(existsSync(wt.path)).toBe(false);
      expect(git(bare, "show", `${wt.branch}:a.txt`)).toBe("edited without identity");
    } finally {
      if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = saved.global;
      if (saved.system === undefined) delete process.env.GIT_CONFIG_SYSTEM;
      else process.env.GIT_CONFIG_SYSTEM = saved.system;
      rmSync(bare, { recursive: true, force: true });
      rmSync(join(bare, "..", ".vibeshell-worktrees"), { recursive: true, force: true });
    }
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
