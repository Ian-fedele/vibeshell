import { describe, expect, it } from "vitest";
import { isAutoAllowed, buildPreview } from "./permissions.js";

const CWD = "/home/user/project";

describe("isAutoAllowed", () => {
  it("auto-allows read-only tools by name (no args)", () => {
    for (const t of ["Read", "Glob", "Grep", "LS", "NotebookRead", "TodoWrite"]) {
      expect(isAutoAllowed(t)).toBe(true);
    }
  });

  it("never auto-allows writing/executing tools", () => {
    for (const t of ["Edit", "Write", "Bash", "search_replace"]) {
      expect(isAutoAllowed(t, {}, CWD)).toBe(false);
    }
  });

  it("auto-allows reads inside the project", () => {
    expect(isAutoAllowed("Read", { file_path: "src/index.ts" }, CWD)).toBe(true);
    expect(isAutoAllowed("Read", { file_path: "./a/b.ts" }, CWD)).toBe(true);
    // An absolute path that genuinely resolves inside cwd is still fine.
    expect(isAutoAllowed("Read", { file_path: `${CWD}/src/x.ts` }, CWD)).toBe(true);
    expect(isAutoAllowed("LS", { path: "." }, CWD)).toBe(true);
    expect(isAutoAllowed("Grep", { pattern: "TODO", path: "src" }, CWD)).toBe(true);
    expect(isAutoAllowed("Glob", { pattern: "src/**/*.ts" }, CWD)).toBe(true);
  });

  it("does NOT auto-allow reads that escape the project", () => {
    // Absolute out-of-project reads (secrets) must fall through to a prompt.
    expect(isAutoAllowed("Read", { file_path: "/etc/passwd" }, CWD)).toBe(false);
    expect(isAutoAllowed("Read", { file_path: "/home/user/.ssh/id_rsa" }, CWD)).toBe(
      false,
    );
    // ../ traversal out of the project.
    expect(isAutoAllowed("Read", { file_path: "../other/.env" }, CWD)).toBe(false);
    expect(isAutoAllowed("LS", { path: "../.." }, CWD)).toBe(false);
    expect(isAutoAllowed("NotebookRead", { notebook_path: "/tmp/x.ipynb" }, CWD)).toBe(
      false,
    );
    // Glob with an absolute or escaping pattern.
    expect(isAutoAllowed("Glob", { pattern: "/etc/**" }, CWD)).toBe(false);
    expect(isAutoAllowed("Glob", { pattern: "../../**" }, CWD)).toBe(false);
  });

  it("TodoWrite has no path args, so it stays auto-allowed with cwd", () => {
    expect(isAutoAllowed("TodoWrite", { todos: [] }, CWD)).toBe(true);
  });
});

describe("buildPreview", () => {
  it("shapes edit/write/bash previews and falls back to other", () => {
    expect(
      buildPreview("Edit", { file_path: "a.ts", old_string: "x", new_string: "y" }),
    ).toEqual({
      kind: "edit",
      path: "a.ts",
      before: "x",
      after: "y",
    });
    expect(buildPreview("Write", { file_path: "a.ts", content: "hi" })).toEqual({
      kind: "write",
      path: "a.ts",
      content: "hi",
    });
    expect(buildPreview("Bash", { command: "ls" })).toEqual({
      kind: "bash",
      command: "ls",
    });
    expect(buildPreview("WebFetch", { url: "https://x.ai" }).kind).toBe("other");
  });
});
