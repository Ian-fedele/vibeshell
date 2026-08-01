import { Pane } from "./Pane";
import { useEngine } from "./useEngine";
import "./App.css";

export default function App() {
  const { state, addPane, sendMessage, closePane } = useEngine();
  const totalCost = state.panes.reduce((sum, p) => sum + p.cost, 0);
  const connected = state.status === "open";

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">vibeshell</span>
        <span className="crumb">D3 · multi-pane</span>
        <span className="spacer" />
        <span className={`conn ${state.status}`}>
          <span className={`dot ${state.status}`} /> {connected ? "engine connected" : state.status}
        </span>
        <span className="total-cost">${totalCost.toFixed(4)}</span>
        <button className="new-session" onClick={addPane} disabled={!connected}>
          + New session
        </button>
      </header>

      <main className="grid">
        {state.panes.map((pane) => (
          <Pane
            key={pane.id}
            pane={pane}
            onSend={(text) => sendMessage(pane.id, text)}
            onClose={() => closePane(pane.id)}
          />
        ))}
      </main>
    </div>
  );
}
