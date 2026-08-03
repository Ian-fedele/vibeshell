import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { CommandPalette, type PaletteAction } from "./CommandPalette";
import { EmptyWorkspace } from "./EmptyWorkspace";
import { Pane } from "./Pane";
import { pickProjectDirectory } from "./pickProject";
import {
  loadProjects,
  projectLabel,
  saveProjects,
  selectProject,
  type ProjectsState,
} from "./projects";
import { ReviewPanel } from "./ReviewPanel";
import { TerminalPane } from "./TerminalPane";
import { Toasts } from "./ToastStack";
import { WorktreeSidebar } from "./WorktreeSidebar";
import { WorkspaceItem } from "./WorkspaceItem";
import { useEngine } from "./useEngine";
import { formatTokens, MODELS_BY_PROVIDER, PROVIDERS, type Pane as PaneState } from "./store";
import { toastSuccess } from "./toasts";
import "./App.css";

const COLUMNS = 2;

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

/** A vertical stack of rows; each row a horizontal group of panes, with drag
 * handles between rows and between columns. */
function buildRows(rows: PaneState[][], renderPane: (pane: PaneState) => ReactNode): ReactNode[] {
  return rows.flatMap((row, ri) => {
    const columns = row.flatMap((pane, ci) => {
      const cell = (
        <Panel key={pane.id} minSize={240}>
          {renderPane(pane)}
        </Panel>
      );
      return ci > 0
        ? [<Separator key={`h-${pane.id}`} className="rh rh-col" />, cell]
        : [cell];
    });
    const rowPanel = (
      <Panel key={`row-${ri}`} minSize={160}>
        <Group orientation="horizontal" className="pg">
          {columns}
        </Group>
      </Panel>
    );
    return ri > 0 ? [<Separator key={`v-${ri}`} className="rh rh-row" />, rowPanel] : [rowPanel];
  });
}

function isModK(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k";
}

export default function App() {
  const {
    state,
    addPane,
    addTerminalPane,
    addWorkspace,
    selectWorkspace,
    renameWorkspace,
    deleteWorkspace,
    setProvider,
    setModel,
    setIsolate,
    setProjectCwd,
    sendMessage,
    closePane,
    closeAllPanesInWorkspace,
    respondPermission,
    undo,
    stopTurn,
    stopAll,
    writeTerminal,
    resizeTerminal,
    subscribeTerminalOutput,
    restartTerminal,
    createTerminal,
    retryPane,
    review,
    openReview,
    closeReview,
    refreshReview,
    rejectReviewPaths,
    worktrees,
    worktreesLoading,
    refreshWorktrees,
    mergeWorktreeBranch,
    discardWorktreeBranch,
  } = useEngine();

  const [projects, setProjects] = useState<ProjectsState>(() => loadProjects());
  const [paletteOpen, setPaletteOpen] = useState(false);

  const connected = state.status === "open";

  // Keep engine creates pointed at the active project folder.
  useEffect(() => {
    setProjectCwd(projects.current);
    saveProjects(projects);
  }, [projects, setProjectCwd]);

  // Refresh isolate branches when project connects/changes.
  useEffect(() => {
    if (!connected) return;
    refreshWorktrees();
  }, [connected, projects.current, refreshWorktrees]);

  const openProjectPath = useCallback(
    (path: string) => {
      setProjects((prev) => selectProject(prev, path));
      toastSuccess("Project set", projectLabel(path));
    },
    [],
  );

  const openProjectPicker = useCallback(async () => {
    const path = await pickProjectDirectory();
    if (path) openProjectPath(path);
  }, [openProjectPath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isModK(e)) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const paneCount = (workspaceId: string) =>
    state.panes.filter((p) => p.workspaceId === workspaceId).length;

  const activePanes = state.panes.filter((p) => p.workspaceId === state.activeWorkspaceId);
  const activeWorkspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
  const workspaceTokens = activePanes.reduce((sum, p) => sum + p.tokens, 0);

  const paletteActions = useMemo((): PaletteAction[] => {
    const actions: PaletteAction[] = [
      {
        id: "new-session",
        label: "New session",
        group: "Panes",
        hint: "Agent",
        keywords: "chat agent",
        disabled: !connected,
        run: addPane,
      },
      {
        id: "new-terminal",
        label: "New terminal",
        group: "Panes",
        hint: "Shell",
        keywords: "pty shell",
        disabled: !connected,
        run: addTerminalPane,
      },
      {
        id: "close-all-panes",
        label: "Close all panes in workspace",
        group: "Panes",
        disabled: activePanes.length === 0,
        run: closeAllPanesInWorkspace,
      },
      {
        id: "stop-all",
        label: "Stop all running turns",
        group: "Panes",
        keywords: "interrupt cancel",
        run: stopAll,
      },
      {
        id: "new-workspace",
        label: "New workspace",
        group: "Workspaces",
        run: addWorkspace,
      },
      {
        id: "open-project",
        label: "Open project…",
        group: "Project",
        keywords: "folder directory cwd",
        run: () => void openProjectPicker(),
      },
      {
        id: "engine-cwd",
        label: "Use engine cwd",
        group: "Project",
        hint: "Default",
        keywords: "reset project",
        run: () => openProjectPath("."),
      },
      {
        id: "toggle-isolate",
        label: state.isolate ? "Disable isolate" : "Enable isolate",
        group: "Session",
        hint: "Worktrees",
        keywords: "git branch worktree",
        run: () => setIsolate(!state.isolate),
      },
      {
        id: "refresh-worktrees",
        label: "Refresh isolate branches",
        group: "Session",
        keywords: "worktree merge",
        disabled: !connected,
        run: refreshWorktrees,
      },
    ];

    const firstAgent = activePanes.find((p) => p.kind === "agent" && p.sessionId);
    if (firstAgent) {
      actions.push({
        id: "review-session",
        label: `Review changes · ${firstAgent.title}`,
        group: "Panes",
        keywords: "diff files accept reject",
        run: () => openReview(firstAgent.id),
      });
    }

    for (const p of PROVIDERS) {
      actions.push({
        id: `provider-${p}`,
        label: `Provider: ${p}`,
        group: "Model",
        keywords: "claude grok",
        run: () => setProvider(p),
      });
    }
    for (const m of MODELS_BY_PROVIDER[state.provider] ?? []) {
      actions.push({
        id: `model-${m}`,
        label: `Model: ${m}`,
        group: "Model",
        hint: state.provider,
        run: () => setModel(m),
      });
    }

    for (const ws of state.workspaces) {
      actions.push({
        id: `ws-${ws.id}`,
        label: `Switch to ${ws.name}`,
        group: "Workspaces",
        disabled: ws.id === state.activeWorkspaceId,
        run: () => selectWorkspace(ws.id),
      });
    }

    for (const path of projects.recent) {
      actions.push({
        id: `recent-${path}`,
        label: projectLabel(path),
        group: "Recent projects",
        hint: path,
        run: () => openProjectPath(path),
      });
    }

    return actions;
  }, [
    activePanes.length,
    addPane,
    addTerminalPane,
    addWorkspace,
    closeAllPanesInWorkspace,
    connected,
    openProjectPath,
    openProjectPicker,
    openReview,
    projects.recent,
    refreshWorktrees,
    selectWorkspace,
    setIsolate,
    setModel,
    setProvider,
    state.activeWorkspaceId,
    state.isolate,
    state.provider,
    state.workspaces,
    stopAll,
  ]);

  const renderPane = (pane: PaneState) => {
    if (pane.kind === "terminal") {
      return (
        <TerminalPane
          pane={pane}
          onClose={() => closePane(pane.id)}
          onWrite={writeTerminal}
          onResize={resizeTerminal}
          onSubscribe={subscribeTerminalOutput}
          onRestart={restartTerminal}
          onEnsure={createTerminal}
        />
      );
    }
    return (
      <Pane
        pane={pane}
        onSend={(text) => sendMessage(pane.id, text)}
        onClose={() => closePane(pane.id)}
        onRespond={(requestId, decision) => respondPermission(pane.id, requestId, decision)}
        onUndo={() => undo(pane.id)}
        onStop={() => stopTurn(pane.id)}
        onReview={() => openReview(pane.id)}
        onRetry={() => retryPane(pane.id)}
      />
    );
  };

  const projLabel = projectLabel(projects.current);
  const recentForEmpty = projects.recent.map((path) => ({
    path,
    label: projectLabel(path),
  }));

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="brand">vibeshell</span>
          <button
            type="button"
            className="icon-btn sidebar-cmd"
            title="Command palette (⌘K)"
            aria-label="Open command palette"
            onClick={() => setPaletteOpen(true)}
          >
            ⌘K
          </button>
        </div>

        <div className="project-block">
          <div className="project-head">Project</div>
          <button
            type="button"
            className="project-current"
            onClick={() => void openProjectPicker()}
            title={projects.current === "." ? "Engine process working directory" : projects.current}
          >
            <span className="project-name">{projLabel}</span>
            <span className="project-change">Change</span>
          </button>
          {projects.recent.length > 0 && (
            <div className="project-recent">
              {projects.recent.slice(0, 4).map((path) => (
                <button
                  key={path}
                  type="button"
                  className={`project-recent-item${path === projects.current ? " is-active" : ""}`}
                  title={path}
                  onClick={() => openProjectPath(path)}
                >
                  {projectLabel(path)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="ws-head">
          <span>Workspaces</span>
          <button className="icon-btn" onClick={addWorkspace} title="New workspace" aria-label="New workspace">
            +
          </button>
        </div>
        <div className="ws-list">
          {state.workspaces.map((ws) => (
            <WorkspaceItem
              key={ws.id}
              workspace={ws}
              active={ws.id === state.activeWorkspaceId}
              count={paneCount(ws.id)}
              canDelete={state.workspaces.length > 1}
              onSelect={() => selectWorkspace(ws.id)}
              onRename={(name) => renameWorkspace(ws.id, name)}
              onDelete={() => deleteWorkspace(ws.id)}
            />
          ))}
        </div>

        <WorktreeSidebar
          items={worktrees}
          loading={worktreesLoading}
          projectLabel={projLabel}
          onRefresh={refreshWorktrees}
          onMerge={mergeWorktreeBranch}
          onDiscard={discardWorktreeBranch}
        />
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            <span className="crumb">{activeWorkspace?.name ?? "Workspace"}</span>
            <span className="crumb-sep" aria-hidden>
              /
            </span>
            <button
              type="button"
              className="crumb-project"
              onClick={() => void openProjectPicker()}
              title={projects.current}
            >
              {projLabel}
            </button>
          </div>
          <select
            className="model-select"
            value={state.provider}
            onChange={(e) => setProvider(e.target.value)}
            title="Provider — applies to empty sessions and new ones"
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            className="model-select"
            value={state.model}
            onChange={(e) => setModel(e.target.value)}
            title="Model — applies to empty sessions and new ones"
          >
            {(MODELS_BY_PROVIDER[state.provider] ?? []).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <span className="spacer" />
          <label className="isolate-toggle" title="Run new sessions in an isolated git worktree + branch">
            <input
              type="checkbox"
              checked={state.isolate}
              onChange={(e) => setIsolate(e.target.checked)}
            />
            isolate
          </label>
          <span className={`conn ${state.status}`}>
            <span className={`dot ${state.status}`} /> {connected ? "connected" : state.status}
          </span>
          <span className="total-cost">{formatTokens(workspaceTokens)} tok</span>
          <button
            type="button"
            className="new-session secondary topbar-cmd"
            onClick={() => setPaletteOpen(true)}
            title="Command palette"
          >
            ⌘K
          </button>
          <button
            className="new-session secondary"
            onClick={addTerminalPane}
            disabled={!connected}
            title="Open an interactive shell pane"
          >
            + Terminal
          </button>
          <button className="new-session" onClick={addPane} disabled={!connected}>
            + Session
          </button>
        </header>

        <main className="grid">
          {activePanes.length === 0 ? (
            <EmptyWorkspace
              projectLabel={projLabel}
              projectPath={projects.current}
              connected={connected}
              onNewSession={addPane}
              onNewTerminal={addTerminalPane}
              onOpenProject={() => void openProjectPicker()}
              onCommandPalette={() => setPaletteOpen(true)}
              recent={recentForEmpty}
              onOpenRecent={openProjectPath}
            />
          ) : (
            <Group
              key={activePanes.map((p) => p.id).join(",")}
              orientation="vertical"
              className="pg"
            >
              {buildRows(chunk(activePanes, COLUMNS), renderPane)}
            </Group>
          )}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        actions={paletteActions}
        onClose={() => setPaletteOpen(false)}
      />
      <ReviewPanel
        open={review.open}
        title={review.paneTitle || "session"}
        files={review.files}
        loading={review.loading}
        canRestore={review.canRestore}
        onClose={closeReview}
        onRefresh={refreshReview}
        onRejectPaths={rejectReviewPaths}
      />
      <Toasts />
    </div>
  );
}
