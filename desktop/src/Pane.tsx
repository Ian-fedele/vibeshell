import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Pane as PaneState } from "./store";

interface PaneProps {
  pane: PaneState;
  onSend: (text: string) => void;
  onClose: () => void;
}

export function Pane({ pane, onSend, onClose }: PaneProps) {
  const [input, setInput] = useState("");
  const feedRef = useRef<HTMLDivElement | null>(null);
  const ready = pane.sessionId !== null;

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [pane.items]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || !ready) return;
    onSend(text);
    setInput("");
  }

  return (
    <section className="pane">
      <div className="pane-title">
        <span className="lights">
          <i />
          <i />
          <i />
        </span>
        <span className="pane-name">{pane.title}</span>
        <button className="pane-close" onClick={onClose} title="Close session" aria-label="Close session">
          ×
        </button>
      </div>

      <div className="feed" ref={feedRef}>
        {pane.items.map((item, i) => {
          if (item.kind === "user") {
            return (
              <div className="row user" key={i}>
                <span className="car">›</span> {item.text}
              </div>
            );
          }
          if (item.kind === "assistant") {
            return (
              <div className="row assistant" key={i}>
                {item.text}
              </div>
            );
          }
          if (item.kind === "tool") {
            return (
              <div className="row tool" key={i}>
                [{item.name}]
              </div>
            );
          }
          if (item.kind === "notice") {
            return (
              <div className="row notice" key={i}>
                {item.text}
              </div>
            );
          }
          return (
            <div className="row result" key={i}>
              {item.ok
                ? `— ${(item.durationMs / 1000).toFixed(1)}s · $${item.costUsd.toFixed(4)} this turn`
                : `— ${item.reason ?? "error"}`}
            </div>
          );
        })}
      </div>

      <form className="composer" onSubmit={submit}>
        <span className="car">›</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={ready ? "Message the agent…" : "Connecting to engine…"}
          disabled={!ready}
        />
      </form>

      <div className="statusbar">
        <span className={`dot ${ready ? "open" : "connecting"}`} />
        <span className="model">claude-opus-5</span>
        <span className="spacer" />
        <span className="cost">${pane.cost.toFixed(4)}</span>
      </div>
    </section>
  );
}
