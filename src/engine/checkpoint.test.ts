import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitCheckpointer, isGitRepo } from "./checkpoint.js";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

describe("gitCheckpointer", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vibeshell-ckpt-"));
    git(dir, "init");
    git(dir, "config", "user.email", "t@t.t");
    git(dir, "config", "user.name", "t");
    writeFileSync(join(dir, "a.txt"), "one\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-m", "init");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("restores modified and deleted files and removes files created after the snapshot", async () => {
    // Also capture an untracked-but-present file in the snapshot.
    writeFileSync(join(dir, "keep.txt"), "keep\n");

    const tree = await gitCheckpointer.snapshot(dir);
    expect(tree).toBeTruthy();

    // Simulate a turn's edits: modify, delete, create.
    writeFileSync(join(dir, "a.txt"), "two\n");
    rmSync(join(dir, "keep.txt"));
    writeFileSync(join(dir, "new.txt"), "created\n");

    const ok = await gitCheckpointer.restore(dir, tree as string);
    expect(ok).toBe(true);

    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("one\n"); // modification reverted
    expect(readFileSync(join(dir, "keep.txt"), "utf8")).toBe("keep\n"); // deletion restored
    expect(existsSync(join(dir, "new.txt"))).toBe(false); // created file removed
  });

  it("returns null when the directory is not a git repo", async () => {
    const plain = mkdtempSync(join(tmpdir(), "vibeshell-plain-"));
    try {
      expect(await isGitRepo(plain)).toBe(false);
      expect(await gitCheckpointer.snapshot(plain)).toBeNull();
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
