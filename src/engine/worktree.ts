/**
 * Git worktree isolation. An isolated session runs in its own linked worktree
 * on a dedicated branch, so its edits never touch the main checkout or other
 * sessions. On teardown, any changes are committed to the branch (so work is
 * preserved) and the worktree directory is removed — the branch keeps the work.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isGitRepo } from "./checkpoint.js";

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

export interface Worktree {
  repo: string;
  path: string;
  branch: string;
}

/** Create a worktree + branch off HEAD for `repo`, or null if not a git repo. */
export async function createWorktree(repo: string, id: string): Promise<Worktree | null> {
  if (!(await isGitRepo(repo))) return null;
  const branch = `vibeshell/${id}`;
  const path = join(dirname(repo), ".vibeshell-worktrees", basename(repo), id);
  await git(repo, ["worktree", "add", "-b", branch, path, "HEAD"]);
  return { repo, path, branch };
}

/** Preserve changes to the branch, then remove the worktree directory. */
export async function removeWorktree(wt: Worktree): Promise<void> {
  let committed = true;
  try {
    await git(wt.path, ["add", "-A"]);
    const dirty = await git(wt.path, ["status", "--porcelain"]);
    if (dirty) {
      // Supply an identity + skip hooks so the commit still lands on machines
      // with no global user.name/user.email (a common cause of silent loss)
      // and repos with pre-commit hooks. Without this the changes were staged
      // but never committed, then force-removed below — the work vanished.
      await git(wt.path, [
        "-c",
        "user.name=vibeshell",
        "-c",
        "user.email=vibeshell@localhost",
        "commit",
        "--no-verify",
        "-m",
        `vibeshell session ${basename(wt.path)}`,
      ]);
    }
  } catch {
    // The commit failed — the work is only in the working tree. Do NOT force
    // remove (that discards it). Leave the worktree in place for recovery.
    committed = false;
  }

  if (!committed) {
    throw new Error(
      `worktree ${wt.path} has uncommitted changes that could not be committed; ` +
        `left in place so the work is recoverable (branch ${wt.branch}).`,
    );
  }

  try {
    await git(wt.repo, ["worktree", "remove", "--force", wt.path]);
  } catch {
    // Committed already, so the branch holds the work — safe to hard-remove
    // the directory and prune the stale worktree registration.
    await rm(wt.path, { recursive: true, force: true }).catch(() => {});
    await git(wt.repo, ["worktree", "prune"]).catch(() => {});
  }
}
