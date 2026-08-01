import { Pane } from "./Pane";
import "./App.css";

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">vibeshell</span>
        <span className="crumb">D2 · one live pane</span>
      </header>
      <main className="grid">
        <Pane />
      </main>
    </div>
  );
}
