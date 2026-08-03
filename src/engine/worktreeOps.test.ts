import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorktree, removeWorktree } from "./worktree.js";
import { mergeBranch } from "./worktreeOps.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** A vibeshell/* branch that edits a.txt, committed and detached from a worktree. */
async function isolateEdit(repo: string, id: string, contents: string): Promise<string> {
  const wt = await createWorktree(repo, id);
  if (!wt) throw new Error("expected a worktree");
  writeFileSync(join(wt.path, "a.txt"), contents);
  await removeWorktree(wt); // commits the edit onto the branch, removes the dir
  return wt.branch;
}

describe("mergeBranch", () => {
  let base: string;
  let repo: string;

  beforeEach(() => {
    // Nest the repo in a unique base so createWorktree's sibling
    // .vibeshell-worktrees dir can't collide with other worktree test files
    // running in parallel.
    base = mkdtempSync(join(tmpdir(), "vibeshell-merge-"));
    repo = join(base, "repo");
    mkdirSync(repo);
    git(repo, "init");
    git(repo, "config", "user.email", "t@t.t");
    git(repo, "config", "user.name", "t");
    writeFileSync(join(repo, "a.txt"), "base\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-m", "init");
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("merges a non-conflicting isolate branch into the current branch", async () => {
    const branch = await isolateEdit(repo, "sess_ok", "base\nfrom isolate\n");
    const msg = await mergeBranch(repo, branch);
    expect(msg).toContain("Merged");
    expect(git(repo, "show", "HEAD:a.txt")).toBe("base\nfrom isolate");
  });

  it("refuses non-vibeshell branches", async () => {
    await expect(mergeBranch(repo, "main")).rejects.toThrow(/non-vibeshell/);
  });

  it("refuses to merge into a dirty working tree", async () => {
    const branch = await isolateEdit(repo, "sess_dirty", "base\nisolate\n");
    writeFileSync(join(repo, "a.txt"), "locally edited\n"); // uncommitted
    await expect(mergeBranch(repo, branch)).rejects.toThrow(/uncommitted changes/);
    // the local edit is left intact
    expect(git(repo, "status", "--porcelain")).not.toBe("");
  });

  it("aborts a conflicting merge and leaves the tree clean", async () => {
    // Diverge main and the isolate branch on the same line → conflict.
    const branch = await isolateEdit(repo, "sess_conflict", "isolate side\n");
    writeFileSync(join(repo, "a.txt"), "main side\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-m", "main diverges");

    await expect(mergeBranch(repo, branch)).rejects.toThrow(/merge aborted/);

    // No lingering conflict state: tree clean, no MERGE_HEAD, content unchanged.
    expect(git(repo, "status", "--porcelain")).toBe("");
    expect(git(repo, "show", "HEAD:a.txt")).toBe("main side");
    expect(() => git(repo, "rev-parse", "--verify", "MERGE_HEAD")).toThrow();
  });
});
