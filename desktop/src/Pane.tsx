import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { formatTokens, type Pane as PaneState } from "./store";
import type { PermissionDecision, ToolLink } from "./protocol";
import { Approval } from "./Approval";
import { Markdown } from "./Markdown";

function linkChipLabel(link: ToolLink): string {
  if (link.title?.trim()) return link.title.trim();
  try {
    const u = new URL(link.url);
    const path = u.pathname === "/" ? "" : u.pathname;
    return u.hostname.replace(/^www\./, "") + path;
  } catch {
    return link.url;
  }
}

async function openExternal(url: string, e: MouseEvent): Promise<void> {
  e.preventDefault();
  try {
    await openUrl(url);
  } catch {
    // Fall back for browser-only / non-Tauri previews.
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

const MAX_COMPOSER_HEIGHT = 160;

interface PaneProps {
  pane: PaneState;
  onSend: (text: string) => void;
  onClose: () => void;
  onRespond: (requestId: string, decision: PermissionDecision) => void;
  onUndo: () => void;
  onStop: () => void;
}

export function Pane({ pane, onSend, onClose, onRespond, onUndo, onStop }: PaneProps) {
  const [input, setInput] = useState("");
  const feedRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const ready = pane.sessionId !== null;
  const providerClass = `provider-${pane.provider || "default"}`;

  // Index of the last assistant bubble (for streaming caret).
  let lastAssistantIdx = -1;
  for (let i = pane.items.length - 1; i >= 0; i--) {
    if (pane.items[i]!.kind === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }
  const lastUserIdx = (() => {
    for (let i = pane.items.length - 1; i >= 0; i--) {
      if (pane.items[i]!.kind === "user") return i;
    }
    return -1;
  })();
  const hasProgressAfterUser =
    lastUserIdx >= 0 &&
    pane.items
      .slice(lastUserIdx + 1)
      .some((it) => it.kind === "assistant" || it.kind === "tool");
  // Waiting bubble when the turn started but nothing has streamed yet.
  const showWaitingBubble = pane.running && !hasProgressAfterUser;

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [pane.items, pane.running]);

  // Grow the composer with its content (up to a cap), then reset when cleared.
  useEffect(() => {
    const ta = composerRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  }, [input]);

  function doSubmit() {
    const text = input.trim();
    if (!text || !ready || pane.running) return;
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
    <section className={`pane ${providerClass}${pane.running ? " is-live" : ""}`}>
      <div className="pane-title">
        <span className="pane-provider-bar" aria-hidden />
        <span className="lights">
          <i />
          <i />
          <i />
        </span>
        <span className="pane-name">{pane.title}</span>
        <span className={`pane-provider-badge ${providerClass}`} title={pane.model}>
          {pane.provider}
        </span>
        {pane.running && (
          <span className="pane-live" title="Turn in progress">
            <span className="pane-live-dot" />
            live
          </span>
        )}
        {pane.branch && (
          <span className="pane-branch" title="Isolated worktree branch">
            ⑂ {pane.branch}
          </span>
        )}
        <span className="pane-title-spacer" />
        {pane.running && (
          <button className="pane-stop" onClick={onStop} title="Stop generation">
            ■ stop
          </button>
        )}
        <button
          className="pane-undo"
          onClick={onUndo}
          disabled={!pane.canUndo || pane.running}
          title="Undo last turn's file changes"
        >
          ↩ undo
        </button>
        <button className="pane-close" onClick={onClose} title="Close session" aria-label="Close session">
          ×
        </button>
      </div>

      <div className="feed" ref={feedRef}>
        {pane.items.length === 0 && !pane.running && (
          <div className="feed-empty">
            <div className="feed-empty-title">Ready</div>
            <div className="feed-empty-sub">
              Message {pane.provider} · {pane.model}
            </div>
          </div>
        )}
        {pane.items.map((item, i) => {
          if (item.kind === "user") {
            return (
              <div className="msg msg-user" key={i}>
                <div className="msg-label">you</div>
                <div className="msg-body">{item.text}</div>
              </div>
            );
          }
          if (item.kind === "assistant") {
            const streaming = pane.running && i === lastAssistantIdx;
            return (
              <div className={`msg msg-assistant${streaming ? " is-streaming" : ""}`} key={i}>
                <div className="msg-label">{pane.provider}</div>
                <div className="msg-body">
                  <Markdown text={item.text} />
                  {streaming && <span className="stream-caret" aria-hidden />}
                </div>
              </div>
            );
          }
          if (item.kind === "tool") {
            const statusClass =
              item.status === "done" ? "done" : item.status === "error" ? "error" : "running";
            return (
              <div className={`msg msg-tool tool-${statusClass}`} key={i}>
                <div className="tool-line">
                  {item.status === "running" && <span className="tool-spinner" aria-hidden />}
                  <span className="tool-name">{item.name}</span>
                  {item.detail && <span className="tool-detail">{item.detail}</span>}
                </div>
                {item.links && item.links.length > 0 && (
                  <div className="tool-links">
                    {item.links.map((link) => (
                      <a
                        key={link.url}
                        className="tool-link"
                        href={link.url}
                        title={link.url}
                        onClick={(e) => void openExternal(link.url, e)}
                      >
                        {linkChipLabel(link)}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          if (item.kind === "notice") {
            return (
              <div className="msg msg-notice" key={i}>
                {item.text}
              </div>
            );
          }
          return (
            <div className="msg msg-result" key={i}>
              {item.ok
                ? `${(item.durationMs / 1000).toFixed(1)}s · ${formatTokens(item.tokens)} tokens`
                : item.reason ?? "error"}
            </div>
          );
        })}
        {showWaitingBubble && (
          <div className="msg msg-assistant is-streaming is-waiting">
            <div className="msg-label">{pane.provider}</div>
            <div className="msg-body">
              <span className="thinking-dots" aria-label="Thinking">
                <i />
                <i />
                <i />
              </span>
              <span className="stream-caret" aria-hidden />
            </div>
          </div>
        )}
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
          placeholder={
            !ready
              ? "Connecting to engine…"
              : pane.running
                ? "Agent is working…  (Stop to cancel)"
                : "Message the agent…  (Enter to send, Shift+Enter for newline)"
          }
          disabled={!ready || pane.running}
        />
        {pane.running ? (
          <button type="button" className="composer-stop" onClick={onStop} title="Stop generation">
            Stop
          </button>
        ) : null}
      </form>

      <div className="statusbar">
        <span className={`dot ${pane.running ? "live" : ready ? "open" : "connecting"}`} />
        <span className="model" title={`${pane.provider} · ${pane.model}`}>
          {pane.provider}/{pane.model}
        </span>
        {pane.running && <span className="status-live">generating</span>}
        <span className="spacer" />
        <span className="cost">{formatTokens(pane.tokens)} tok</span>
      </div>
    </section>
  );
}
