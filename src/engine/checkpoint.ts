/**
 * Per-turn working-tree checkpoints, so a turn's file changes can be undone.
 * Uses git plumbing with a throwaway index file, so it captures the full
 * working tree (tracked + untracked, minus gitignored) without disturbing the
 * repo's real index or HEAD.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);

async function git(cwd: string, args: string[], indexFile?: string): Promise<string> {
  const env = indexFile ? { ...process.env, GIT_INDEX_FILE: indexFile } : process.env;
  const { stdout } = await run("git", args, { cwd, env, maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    return (await git(cwd, ["rev-parse", "--is-inside-work-tree"])) === "true";
  } catch {
    return false;
  }
}

/** A pluggable checkpoint backend (injected in tests). */
export interface Checkpointer {
  /** Capture the working tree; returns a tree ref, or null if not checkpointable. */
  snapshot(cwd: string): Promise<string | null>;
  /** Restore the working tree to a prior snapshot. */
  restore(cwd: string, tree: string): Promise<boolean>;
}

export const gitCheckpointer: Checkpointer = {
  async snapshot(cwd: string): Promise<string | null> {
    if (!(await isGitRepo(cwd))) return null;
    const indexFile = join(tmpdir(), `vibeshell-idx-${randomBytes(6).toString("hex")}`);
    try {
      // Fresh temp index: stage every non-ignored file, then write it as a tree.
      await git(cwd, ["add", "-A"], indexFile);
      return await git(cwd, ["write-tree"], indexFile);
    } finally {
      await rm(indexFile, { force: true }).catch(() => {});
    }
  },

  async restore(cwd: string, tree: string): Promise<boolean> {
    if (!(await isGitRepo(cwd))) return false;
    const indexFile = join(tmpdir(), `vibeshell-idx-${randomBytes(6).toString("hex")}`);
    try {
      // Restore the working tree via a throwaway index so a mid-operation
      // failure can't leave the user's real index half-rewritten.
      await git(cwd, ["read-tree", tree], indexFile); // temp index := snapshot
      await git(cwd, ["checkout-index", "-a", "-f"], indexFile); // working files := snapshot
      // clean against the temp index so the snapshot's files count as tracked
      // (kept) and only files created after the snapshot are removed.
      await git(cwd, ["clean", "-fd"], indexFile); // respects .gitignore
      // Only now sync the real index to the snapshot, so `git status` is clean.
      await git(cwd, ["read-tree", tree]);
    } finally {
      await rm(indexFile, { force: true }).catch(() => {});
    }
    return true;
  },
};
