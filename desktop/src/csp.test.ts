import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Regression guard: the Tauri webview renders agent output, tool results, and
 * web-fetched content, so it must ship a real Content-Security-Policy — never
 * `null` (which disables CSP entirely). This test fails if the CSP is dropped
 * or a key directive is removed.
 */
describe("tauri CSP", () => {
  const confPath = fileURLToPath(new URL("../src-tauri/tauri.conf.json", import.meta.url));
  const conf = JSON.parse(readFileSync(confPath, "utf8")) as {
    app?: { security?: { csp?: unknown } };
  };
  const csp = conf.app?.security?.csp;

  it("is a non-null policy string", () => {
    expect(typeof csp).toBe("string");
    expect((csp as string).length).toBeGreaterThan(0);
  });

  it("locks down the dangerous directives", () => {
    const policy = csp as string;
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("script-src 'self'"); // no remote/inline scripts
    // The engine WebSocket (local or remote) must stay reachable.
    expect(/connect-src[^;]*\bws:/.test(policy)).toBe(true);
  });
});
