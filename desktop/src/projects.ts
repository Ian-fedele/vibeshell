/**
 * Recent project folders. Paths are absolute (or "." for engine default cwd).
 */
export const PROJECTS_KEY = "vibeshell.projects.v1";
export const MAX_RECENT = 12;

export interface ProjectsState {
  /** Active project directory. "." means engine process cwd. */
  current: string;
  recent: string[];
}

export const DEFAULT_PROJECTS: ProjectsState = {
  current: ".",
  recent: [],
};

function normalizePath(path: string): string {
  const t = path.trim();
  if (!t || t === ".") return ".";
  // Strip trailing slashes (keep root "/").
  if (t.length > 1 && (t.endsWith("/") || t.endsWith("\\"))) {
    return t.replace(/[/\\]+$/, "");
  }
  return t;
}

export function projectLabel(path: string): string {
  const p = normalizePath(path);
  if (p === ".") return "Engine cwd";
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

export function projectParent(path: string): string {
  const p = normalizePath(path);
  if (p === ".") return "";
  const parts = p.split(/[/\\]/).filter(Boolean);
  if (parts.length <= 1) return p;
  return parts.slice(0, -1).join(p.includes("\\") ? "\\" : "/");
}

export function loadProjects(
  storage: Pick<Storage, "getItem"> | null = typeof localStorage !== "undefined"
    ? localStorage
    : null,
): ProjectsState {
  if (!storage) return { ...DEFAULT_PROJECTS, recent: [] };
  try {
    const raw = storage.getItem(PROJECTS_KEY);
    if (!raw) return { ...DEFAULT_PROJECTS, recent: [] };
    const data = JSON.parse(raw) as Partial<ProjectsState>;
    const current =
      typeof data.current === "string" ? normalizePath(data.current) : ".";
    const recent = Array.isArray(data.recent)
      ? data.recent
          .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
          .map(normalizePath)
          .filter((p) => p !== ".")
          .slice(0, MAX_RECENT)
      : [];
    return { current, recent };
  } catch {
    return { ...DEFAULT_PROJECTS, recent: [] };
  }
}

export function saveProjects(
  state: ProjectsState,
  storage: Pick<Storage, "setItem"> | null = typeof localStorage !== "undefined"
    ? localStorage
    : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(
      PROJECTS_KEY,
      JSON.stringify({
        current: normalizePath(state.current),
        recent: state.recent.map(normalizePath).slice(0, MAX_RECENT),
      }),
    );
  } catch {
    // ignore quota
  }
}

/** Set current project and bump it to the front of recent (unless "."). */
export function selectProject(state: ProjectsState, path: string): ProjectsState {
  const current = normalizePath(path);
  if (current === ".") {
    return { ...state, current };
  }
  const recent = [current, ...state.recent.filter((p) => p !== current)].slice(0, MAX_RECENT);
  return { current, recent };
}

/** Resolve cwd string sent to the engine for new sessions/terminals. */
export function cwdForEngine(projectPath: string): string {
  const p = normalizePath(projectPath);
  return p === "." ? "." : p;
}
