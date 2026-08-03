/**
 * Working-tree diffs and per-file restore for the session review UI.
 * Diffs are against HEAD (committed base). When a turn checkpoint tree is
 * available, reject-file restores from that snapshot instead of HEAD so the
 * user undoes only the agent's last turn for those paths.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { isGitRepo } from "./checkpoint.js";

/**
 * True when `rel` resolves to a path strictly inside `cwd` (not `cwd` itself).
 * Guards restore against `../` traversal and absolute paths arriving over the
 * unauthenticated engine protocol — a restore must never touch anything outside
 * the project it targets.
 */
export function isInsideCwd(cwd: string, rel: string): boolean {
  const root = resolve(cwd);
  const abs = resolve(root, rel);
  return abs !== root && abs.startsWith(root + sep);
}

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

export type DiffStatus = "modified" | "added" | "deleted" | "renamed" | "unknown";

export interface DiffFile {
  path: string;
  status: DiffStatus;
  /** Unified diff snippet (may be truncated). */
  patch: string;
  additions: number;
  deletions: number;
}

export interface SessionDiff {
  cwd: string;
  files: DiffFile[];
  /** True when a turn checkpoint is available for targeted restore. */
  canRestoreFromCheckpoint: boolean;
}

const MAX_PATCH_CHARS = 12_000;

function parseStatusChar(code: string): DiffStatus {
  switch (code) {
    case "M":
      return "modified";
    case "A":
    case "?":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    default:
      return "unknown";
  }
}

function countPatchStats(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@"))
      continue;
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

/** List changed files + patches vs HEAD in `cwd`. */
export async function getWorkingTreeDiff(cwd: string): Promise<DiffFile[]> {
  if (!(await isGitRepo(cwd))) return [];

  // Porcelain: XY path  (or "R100 old -> new")
  const statusOut = await git(cwd, ["status", "--porcelain", "-uall"]);
  if (!statusOut.trim()) return [];

  const files: DiffFile[] = [];
  for (const line of statusOut.split("\n")) {
    if (!line.trim()) continue;
    const code = (line[0] === " " ? line[1] : line[0]) || "?";
    let path = line.slice(3);
    if (path.includes(" -> ")) {
      path = path.split(" -> ").pop()!.trim();
    }
    // Untracked
    if (line.startsWith("??")) {
      path = line.slice(3);
    }
    path = path.replace(/^"|"$/g, "");
    if (!path) continue;

    let patch = "";
    try {
      if (line.startsWith("??")) {
        // Show new file as all additions (capped).
        const show = await git(cwd, [
          "diff",
          "--no-index",
          "--",
          "/dev/null",
          path,
        ]).catch(async () => {
          // git diff --no-index exits 1 when different; still prints diff on stdout via error...
          try {
            const { stdout } = await run(
              "git",
              ["diff", "--no-index", "--", "/dev/null", path],
              {
                cwd,
                maxBuffer: 32 * 1024 * 1024,
              },
            );
            return stdout;
          } catch (err: unknown) {
            const e = err as { stdout?: string };
            return e.stdout ?? "";
          }
        });
        patch = typeof show === "string" ? show : "";
      } else if (code === "D") {
        patch = await git(cwd, ["diff", "HEAD", "--", path]);
      } else {
        patch = await git(cwd, ["diff", "HEAD", "--", path]);
        if (!patch.trim()) {
          // staged-only
          patch = await git(cwd, ["diff", "--cached", "HEAD", "--", path]);
        }
      }
    } catch {
      patch = "";
    }

    if (patch.length > MAX_PATCH_CHARS) {
      patch = patch.slice(0, MAX_PATCH_CHARS) + "\n… (truncated)";
    }
    const { additions, deletions } = countPatchStats(patch);
    files.push({
      path,
      status: parseStatusChar(line.startsWith("??") ? "?" : code),
      patch,
      additions,
      deletions,
    });
  }

  // Stable sort by path
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

/**
 * Restore paths to `tree` (checkpoint) when provided, else HEAD.
 * New untracked files are deleted. Missing paths are skipped.
 */
export async function restorePaths(
  cwd: string,
  paths: string[],
  tree: string | null,
): Promise<{ restored: string[]; removed: string[]; errors: string[] }> {
  const restored: string[] = [];
  const removed: string[] = [];
  const errors: string[] = [];
  if (!(await isGitRepo(cwd)) || paths.length === 0) {
    return { restored, removed, errors };
  }

  for (const rel of paths) {
    // Reject anything that escapes the project before running git / rm on it.
    if (!isInsideCwd(cwd, rel)) {
      errors.push(`${rel}: refusing to restore a path outside the project`);
      continue;
    }
    const abs = join(cwd, rel);
    try {
      if (tree) {
        // Does the path exist in the checkpoint tree?
        try {
          await git(cwd, ["cat-file", "-e", `${tree}:${rel}`]);
          await git(cwd, ["checkout", tree, "--", rel]);
          restored.push(rel);
          continue;
        } catch {
          // Not in tree → was added after checkpoint; remove.
        }
      } else {
        // HEAD version?
        try {
          await git(cwd, ["cat-file", "-e", `HEAD:${rel}`]);
          await git(cwd, ["checkout", "HEAD", "--", rel]);
          restored.push(rel);
          continue;
        } catch {
          // not in HEAD
        }
      }
      // Remove file/dir if present
      try {
        await access(abs);
        await rm(abs, { recursive: true, force: true });
        removed.push(rel);
      } catch {
        // already gone
        removed.push(rel);
      }
    } catch (err) {
      errors.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { restored, removed, errors };
}
