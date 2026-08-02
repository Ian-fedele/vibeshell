import type { ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Pane } from "./Pane";
import { WorkspaceItem } from "./WorkspaceItem";
import { useEngine } from "./useEngine";
import { formatTokens, MODELS, type Pane as PaneState } from "./store";
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

export default function App() {
  const {
    state,
    addPane,
    addWorkspace,
    selectWorkspace,
    renameWorkspace,
    deleteWorkspace,
    setModel,
    setIsolate,
    sendMessage,
    closePane,
    respondPermission,
    undo,
  } = useEngine();
  const connected = state.status === "open";

  const paneCount = (workspaceId: string) =>
    state.panes.filter((p) => p.workspaceId === workspaceId).length;

  const activePanes = state.panes.filter((p) => p.workspaceId === state.activeWorkspaceId);
  const activeWorkspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
  const workspaceTokens = activePanes.reduce((sum, p) => sum + p.tokens, 0);

  const renderPane = (pane: PaneState) => (
    <Pane
      pane={pane}
      onSend={(text) => sendMessage(pane.id, text)}
      onClose={() => closePane(pane.id)}
      onRespond={(requestId, decision) => respondPermission(pane.id, requestId, decision)}
      onUndo={() => undo(pane.id)}
    />
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="brand">vibeshell</span>
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
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="crumb">{activeWorkspace?.name ?? "Workspace"}</span>
          <select
            className="model-select"
            value={state.model}
            onChange={(e) => setModel(e.target.value)}
            title="Model for new sessions"
          >
            {MODELS.map((m) => (
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
            <span className={`dot ${state.status}`} /> {connected ? "engine connected" : state.status}
          </span>
          <span className="total-cost">{formatTokens(workspaceTokens)} tok</span>
          <button className="new-session" onClick={addPane} disabled={!connected}>
            + New session
          </button>
        </header>

        <main className="grid">
          {activePanes.length === 0 ? (
            <div className="empty">No sessions in this workspace. Click “+ New session”.</div>
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
    </div>
  );
}
