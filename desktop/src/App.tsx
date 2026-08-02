import { Pane } from "./Pane";
import { WorkspaceItem } from "./WorkspaceItem";
import { useEngine } from "./useEngine";
import { formatTokens, MODELS } from "./store";
import "./App.css";

export default function App() {
  const {
    state,
    addPane,
    addWorkspace,
    selectWorkspace,
    renameWorkspace,
    deleteWorkspace,
    setModel,
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
            activePanes.map((pane) => (
              <Pane
                key={pane.id}
                pane={pane}
                onSend={(text) => sendMessage(pane.id, text)}
                onClose={() => closePane(pane.id)}
                onRespond={(requestId, decision) => respondPermission(pane.id, requestId, decision)}
                onUndo={() => undo(pane.id)}
              />
            ))
          )}
        </main>
      </div>
    </div>
  );
}
