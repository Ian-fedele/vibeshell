import { describe, expect, it } from "vitest";
import {
  cwdForEngine,
  DEFAULT_PROJECTS,
  loadProjects,
  projectLabel,
  saveProjects,
  selectProject,
} from "./projects";

describe("projects", () => {
  it("labels basename and engine cwd", () => {
    expect(projectLabel(".")).toBe("Engine cwd");
    expect(projectLabel("/Users/ian/dev/vibeshell")).toBe("vibeshell");
    expect(projectLabel("/Users/ian/dev/vibeshell/")).toBe("vibeshell");
  });

  it("selectProject bumps recent and sets current", () => {
    const next = selectProject(DEFAULT_PROJECTS, "/tmp/demo");
    expect(next.current).toBe("/tmp/demo");
    expect(next.recent[0]).toBe("/tmp/demo");
    const again = selectProject(next, "/tmp/other");
    expect(again.recent).toEqual(["/tmp/other", "/tmp/demo"]);
  });

  it("does not put engine cwd into recent", () => {
    const next = selectProject(selectProject(DEFAULT_PROJECTS, "/tmp/demo"), ".");
    expect(next.current).toBe(".");
    expect(next.recent).toEqual(["/tmp/demo"]);
  });

  it("round-trips through storage", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
    };
    const state = selectProject(DEFAULT_PROJECTS, "/Users/x/proj");
    saveProjects(state, storage);
    const loaded = loadProjects(storage);
    expect(loaded.current).toBe("/Users/x/proj");
    expect(loaded.recent).toEqual(["/Users/x/proj"]);
  });

  it("cwdForEngine keeps absolute paths", () => {
    expect(cwdForEngine(".")).toBe(".");
    expect(cwdForEngine("/tmp/a")).toBe("/tmp/a");
  });
});
