/**
 * node-pty's prebuild ships `spawn-helper` without +x under some package
 * managers (pnpm with ignored build scripts). Without the exec bit, every
 * spawn fails on macOS/Linux with "posix_spawnp failed".
 */
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

function findPrebuildsRoot() {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve("node-pty/package.json");
    return join(dirname(pkg), "prebuilds");
  } catch {
    // Running from a nested package — try repo root node_modules.
    const here = dirname(fileURLToPath(import.meta.url));
    return join(here, "..", "node_modules", "node-pty", "prebuilds");
  }
}

function fix() {
  const root = findPrebuildsRoot();
  if (!existsSync(root)) {
    console.warn("[fix-node-pty] no prebuilds at", root);
    return;
  }
  let fixed = 0;
  for (const plat of readdirSync(root)) {
    const helper = join(root, plat, "spawn-helper");
    if (!existsSync(helper)) continue;
    const mode = statSync(helper).mode;
    // Ensure owner/group/other execute bits.
    const next = mode | 0o111;
    if (next !== mode) {
      chmodSync(helper, next);
      fixed += 1;
      console.log("[fix-node-pty] chmod +x", helper);
    }
  }
  if (fixed === 0) {
    console.log("[fix-node-pty] spawn-helper already executable");
  }
}

fix();
