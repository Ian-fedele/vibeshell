import { Pane } from "./Pane";
import { useEngine } from "./useEngine";
import "./App.css";

export default function App() {
  const { state, addPane, addWorkspace, selectWorkspace, sendMessage, closePane } = useEngine();
  const connected = state.status === "open";

  const paneCount = (workspaceId: string) =>
    state.panes.filter((p) => p.workspaceId === workspaceId).length;

  const activePanes = state.panes.filter((p) => p.workspaceId === state.activeWorkspaceId);
  const activeWorkspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
  const workspaceCost = activePanes.reduce((sum, p) => sum + p.cost, 0);

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
            <button
              key={ws.id}
              className={`ws-item${ws.id === state.activeWorkspaceId ? " active" : ""}`}
              onClick={() => selectWorkspace(ws.id)}
            >
              <span className="ws-name">{ws.name}</span>
              <span className="ws-count">{paneCount(ws.id)}</span>
            </button>
          ))}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="crumb">{activeWorkspace?.name ?? "Workspace"}</span>
          <span className="spacer" />
          <span className={`conn ${state.status}`}>
            <span className={`dot ${state.status}`} /> {connected ? "engine connected" : state.status}
          </span>
          <span className="total-cost">${workspaceCost.toFixed(4)}</span>
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
              />
            ))
          )}
        </main>
      </div>
    </div>
  );
}
