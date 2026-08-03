interface EmptyWorkspaceProps {
  projectLabel: string;
  projectPath: string;
  connected: boolean;
  onNewSession: () => void;
  onNewTerminal: () => void;
  onOpenProject: () => void;
  onCommandPalette: () => void;
  recent: Array<{ path: string; label: string }>;
  onOpenRecent: (path: string) => void;
}

export function EmptyWorkspace({
  projectLabel,
  projectPath,
  connected,
  onNewSession,
  onNewTerminal,
  onOpenProject,
  onCommandPalette,
  recent,
  onOpenRecent,
}: EmptyWorkspaceProps) {
  return (
    <div className="empty-hero">
      <div className="empty-hero-card">
        <div className="empty-kicker">Workspace</div>
        <h2 className="empty-title">Ready when you are</h2>
        <p className="empty-sub">
          Run agents and shells side by side.
          {projectPath !== "." ? (
            <>
              {" "}
              Project: <span className="empty-path">{projectLabel}</span>
            </>
          ) : (
            <> Open a project folder, or start a session in the engine cwd.</>
          )}
        </p>
        <div className="empty-actions">
          <button
            type="button"
            className="empty-btn primary"
            onClick={onNewSession}
            disabled={!connected}
          >
            + New session
          </button>
          <button
            type="button"
            className="empty-btn"
            onClick={onNewTerminal}
            disabled={!connected}
          >
            + Terminal
          </button>
          <button type="button" className="empty-btn" onClick={onOpenProject}>
            Open project…
          </button>
          <button type="button" className="empty-btn ghost" onClick={onCommandPalette}>
            Command palette
            <kbd>⌘K</kbd>
          </button>
        </div>
        {recent.length > 0 && (
          <div className="empty-recent">
            <div className="empty-recent-head">Recent projects</div>
            <ul>
              {recent.slice(0, 5).map((r) => (
                <li key={r.path}>
                  <button type="button" onClick={() => onOpenRecent(r.path)} title={r.path}>
                    <span className="empty-recent-name">{r.label}</span>
                    <span className="empty-recent-path">{r.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!connected && (
          <div className="empty-warn">Waiting for engine connection…</div>
        )}
      </div>
    </div>
  );
}
