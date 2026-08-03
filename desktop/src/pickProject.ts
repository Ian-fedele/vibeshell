/**
 * Pick a project directory. Uses Tauri dialog when available; falls back to
 * a prompt so browser-only previews still work.
 */
export async function pickProjectDirectory(): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open project folder",
    });
    if (typeof selected === "string" && selected.trim()) return selected.trim();
    return null;
  } catch {
    // Not in Tauri, or plugin missing.
  }
  const typed = window.prompt("Project folder path (absolute)");
  const t = typed?.trim();
  return t ? t : null;
}
