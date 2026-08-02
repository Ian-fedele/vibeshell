import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { formatTokens, type Pane as PaneState } from "./store";
import type { PermissionDecision } from "./protocol";
import { Approval } from "./Approval";

const MAX_COMPOSER_HEIGHT = 160;

interface PaneProps {
  pane: PaneState;
  onSend: (text: string) => void;
  onClose: () => void;
  onRespond: (requestId: string, decision: PermissionDecision) => void;
  onUndo: () => void;
}

export function Pane({ pane, onSend, onClose, onRespond, onUndo }: PaneProps) {
  const [input, setInput] = useState("");
  const feedRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const ready = pane.sessionId !== null;

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [pane.items]);

  // Grow the composer with its content (up to a cap), then reset when cleared.
  useEffect(() => {
    const ta = composerRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  }, [input]);

  function doSubmit() {
    const text = input.trim();
    if (!text || !ready) return;
    onSend(text);
    setInput("");
  }

  function onFormSubmit(e: FormEvent) {
    e.preventDefault();
    doSubmit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline. Ignore IME composition.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      doSubmit();
    }
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
        {pane.branch && <span className="pane-branch" title="Isolated worktree branch">⑂ {pane.branch}</span>}
        <button
          className="pane-undo"
          onClick={onUndo}
          disabled={!pane.canUndo}
          title="Undo last turn's file changes"
        >
          ↩ undo
        </button>
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
                ? `— ${(item.durationMs / 1000).toFixed(1)}s · ${formatTokens(item.tokens)} tokens`
                : `— ${item.reason ?? "error"}`}
            </div>
          );
        })}
      </div>

      {pane.pending && (
        <Approval
          request={pane.pending}
          onDecide={(decision) => onRespond(pane.pending!.requestId, decision)}
        />
      )}

      <form className="composer" onSubmit={onFormSubmit}>
        <span className="car">›</span>
        <textarea
          ref={composerRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={ready ? "Message the agent…  (Enter to send, Shift+Enter for newline)" : "Connecting to engine…"}
          disabled={!ready}
        />
      </form>

      <div className="statusbar">
        <span className={`dot ${ready ? "open" : "connecting"}`} />
        <span className="model">claude-opus-5</span>
        <span className="spacer" />
        <span className="cost">{formatTokens(pane.tokens)} tok</span>
      </div>
    </section>
  );
}
