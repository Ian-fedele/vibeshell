/**
 * node-pty's macOS/Linux prebuild includes a `spawn-helper` binary that must
 * be executable. Some installs (pnpm with ignored build scripts) leave it
 * mode 0644, and every spawn then fails with "posix_spawnp failed".
 */
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

let didRun = false;

export function ensureNodePtyExecutable(): void {
  if (didRun) return;
  didRun = true;
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve("node-pty/package.json");
    const root = join(dirname(pkgJson), "prebuilds");
    if (!existsSync(root)) return;
    for (const plat of readdirSync(root)) {
      const helper = join(root, plat, "spawn-helper");
      if (!existsSync(helper)) continue;
      const mode = statSync(helper).mode;
      const next = mode | 0o111;
      if (next !== mode) {
        chmodSync(helper, next);
        console.error(
          `[vibeshell engine] fixed node-pty spawn-helper permissions: ${helper}`,
        );
      }
    }
  } catch (err) {
    // Best-effort — spawn will surface a clearer error if it still fails.
    console.error(
      `[vibeshell engine] could not ensure node-pty permissions: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
