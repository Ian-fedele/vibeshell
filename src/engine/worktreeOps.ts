/**
 * List / merge / discard vibeshell isolation branches and their worktrees.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rm } from "node:fs/promises";
import { isGitRepo } from "./checkpoint.js";

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

export interface WorktreeListItem {
  branch: string;
  /** Absolute path if a worktree is checked out; null if branch-only. */
  path: string | null;
  /** True when this is the main repo checkout (not a vibeshell isolate). */
  isMain: boolean;
  /** Ahead of merge-base with HEAD (best-effort). */
  commits?: number;
  dirty?: boolean;
}

/** Branches created by isolate sessions: vibeshell/<id> */
export async function listVibeshellWorktrees(repo: string): Promise<WorktreeListItem[]> {
  if (!(await isGitRepo(repo))) return [];

  const items: WorktreeListItem[] = [];
  const branchOut = await git(repo, ["branch", "--list", "vibeshell/*"]);
  const branches = branchOut
    .split("\n")
    .map((l) => l.replace(/^\*?\s+/, "").trim())
    .filter(Boolean);

  // Map worktree paths → branch
  const wtOut = await git(repo, ["worktree", "list", "--porcelain"]);
  const pathByBranch = new Map<string, string>();
  let curPath = "";
  for (const line of wtOut.split("\n")) {
    if (line.startsWith("worktree ")) curPath = line.slice("worktree ".length);
    if (line.startsWith("branch refs/heads/")) {
      const b = line.slice("branch refs/heads/".length);
      pathByBranch.set(b, curPath);
    }
  }

  for (const branch of branches) {
    const path = pathByBranch.get(branch) ?? null;
    let dirty = false;
    let commits = 0;
    try {
      commits = Number(
        (await git(repo, ["rev-list", "--count", `HEAD..${branch}`]).catch(() => "0")) ||
          "0",
      );
    } catch {
      commits = 0;
    }
    if (path) {
      try {
        dirty = !!(await git(path, ["status", "--porcelain"]));
      } catch {
        dirty = false;
      }
    }
    items.push({ branch, path, isMain: false, commits, dirty });
  }

  items.sort((a, b) => a.branch.localeCompare(b.branch));
  return items;
}

/** Merge `branch` into the current branch of `repo`. */
export async function mergeBranch(repo: string, branch: string): Promise<string> {
  if (!(await isGitRepo(repo))) throw new Error("not a git repository");
  if (!branch.startsWith("vibeshell/"))
    throw new Error("refusing to merge non-vibeshell branch");
  // Ensure branch exists
  await git(repo, ["rev-parse", "--verify", branch]);

  // Refuse to merge into a dirty tree: a merge that touches those files would
  // fail partway and leave the checkout in a confusing state. Make the user
  // commit/stash first with a clear message instead.
  const dirty = await git(repo, ["status", "--porcelain"]).catch(() => "");
  if (dirty.trim()) {
    throw new Error(
      "working tree has uncommitted changes — commit or stash them before merging",
    );
  }

  try {
    await git(repo, ["merge", "--no-ff", branch, "-m", `Merge ${branch} (vibeshell)`]);
    return `Merged ${branch} into current branch`;
  } catch (err) {
    // A conflicting merge leaves MERGE_HEAD + conflict markers behind. Abort so
    // the checkout is restored to its pre-merge state rather than stranded.
    await git(repo, ["merge", "--abort"]).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    const e = err as { stderr?: string };
    const detail = e.stderr?.trim() || msg || "merge failed";
    throw new Error(`${detail} (merge aborted; working tree unchanged)`);
  }
}

/**
 * Remove worktree (if any), optionally delete the branch.
 * Commits dirty worktree first when `preserve` is true (default).
 */
export async function discardBranch(
  repo: string,
  branch: string,
  opts?: { deleteBranch?: boolean; preserve?: boolean },
): Promise<string> {
  if (!(await isGitRepo(repo))) throw new Error("not a git repository");
  if (!branch.startsWith("vibeshell/"))
    throw new Error("refusing to discard non-vibeshell branch");

  const deleteBranch = opts?.deleteBranch ?? true;
  const preserve = opts?.preserve ?? false;

  const wtOut = await git(repo, ["worktree", "list", "--porcelain"]);
  let wtPath: string | null = null;
  let curPath = "";
  for (const line of wtOut.split("\n")) {
    if (line.startsWith("worktree ")) curPath = line.slice("worktree ".length);
    if (line === `branch refs/heads/${branch}`) wtPath = curPath;
  }

  if (wtPath) {
    if (preserve) {
      try {
        await git(wtPath, ["add", "-A"]);
        const dirty = await git(wtPath, ["status", "--porcelain"]);
        if (dirty) await git(wtPath, ["commit", "-m", `vibeshell preserve ${branch}`]);
      } catch {
        // best effort
      }
    }
    try {
      await git(repo, ["worktree", "remove", "--force", wtPath]);
    } catch {
      await rm(wtPath, { recursive: true, force: true }).catch(() => {});
      await git(repo, ["worktree", "prune"]).catch(() => {});
    }
  }

  if (deleteBranch) {
    try {
      await git(repo, ["branch", "-D", branch]);
    } catch (err) {
      const e = err as { stderr?: string };
      throw new Error(
        e.stderr?.trim() || (err instanceof Error ? err.message : "delete failed"),
      );
    }
    return wtPath ? `Removed worktree and deleted ${branch}` : `Deleted branch ${branch}`;
  }
  return wtPath ? `Removed worktree for ${branch}` : `No worktree for ${branch}`;
}
