/**
 * Lightweight env helpers for the engine sidecar. Avoids a dotenv dependency:
 * load KEY=VALUE lines into process.env when the key is not already set.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let loaded = false;

/** Strip optional surrounding quotes from a .env value. */
function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/** Parse a .env-style file and apply keys that are not already in process.env. */
export function applyEnvFile(path: string): void {
  if (!existsSync(path)) return;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined && process.env[key] !== "") continue;
    process.env[key] = unquote(line.slice(eq + 1));
  }
}

/**
 * Load vibeshell-related env files once. Search order (later does not override
 * earlier, and process.env always wins):
 *   1. process.cwd()/.env
 *   2. package root/.env (engine repo)
 *   3. ~/.vibeshell/.env
 *   4. ~/.config/vibeshell/env
 */
export function loadVibeshellEnv(): void {
  if (loaded) return;
  loaded = true;

  const candidates: string[] = [join(process.cwd(), ".env")];

  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // src/agent → repo root, or dist/ → repo root
    candidates.push(join(here, "..", "..", ".env"));
    candidates.push(join(here, "..", ".env"));
  } catch {
    // ignore — import.meta.url unavailable in odd runtimes
  }

  const home = homedir();
  candidates.push(join(home, ".vibeshell", ".env"));
  candidates.push(join(home, ".config", "vibeshell", "env"));

  for (const path of candidates) applyEnvFile(path);
}

/** Non-empty env value, or undefined. */
export function envValue(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}
