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
  try {
    await git(wt.path, ["add", "-A"]);
    const dirty = await git(wt.path, ["status", "--porcelain"]);
    if (dirty)
      await git(wt.path, ["commit", "-m", `vibeshell session ${basename(wt.path)}`]);
  } catch {
    // best effort — proceed to remove even if the commit failed
  }
  try {
    await git(wt.repo, ["worktree", "remove", "--force", wt.path]);
  } catch {
    // fall back to a raw directory removal + prune
    await rm(wt.path, { recursive: true, force: true }).catch(() => {});
    await git(wt.repo, ["worktree", "prune"]).catch(() => {});
  }
}
