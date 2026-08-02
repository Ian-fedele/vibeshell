import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMcpServers } from "./mcp.js";

describe("loadMcpServers", () => {
  const dirs: string[] = [];
  const makeDir = (): string => {
    const d = mkdtempSync(join(tmpdir(), "vibeshell-mcp-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("returns the mcpServers record when .mcp.json is present", () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, ".mcp.json"),
      JSON.stringify({
        mcpServers: { github: { type: "http", url: "https://example.com/mcp" } },
      }),
    );
    expect(loadMcpServers(dir)).toEqual({
      github: { type: "http", url: "https://example.com/mcp" },
    });
  });

  it("returns undefined when the file is absent", () => {
    expect(loadMcpServers(makeDir())).toBeUndefined();
  });

  it("returns undefined for malformed or empty config", () => {
    const dir = makeDir();
    writeFileSync(join(dir, ".mcp.json"), "{ not json");
    expect(loadMcpServers(dir)).toBeUndefined();

    const dir2 = makeDir();
    writeFileSync(join(dir2, ".mcp.json"), JSON.stringify({ mcpServers: {} }));
    expect(loadMcpServers(dir2)).toBeUndefined();
  });
});
