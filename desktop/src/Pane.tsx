import { useEffect, useRef, useState, type FormEvent } from "react";
import { EngineClient, type ConnectionStatus } from "./engine";
import type { EngineEvent } from "./protocol";

type FeedItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string }
  | { kind: "result"; ok: boolean; durationMs: number; costUsd: number; reason?: string };

const MODEL = "claude-opus-5";

function appendAssistant(prev: FeedItem[], text: string): FeedItem[] {
  const last = prev[prev.length - 1];
  if (last && last.kind === "assistant") {
    return [...prev.slice(0, -1), { kind: "assistant", text: last.text + text }];
  }
  return [...prev, { kind: "assistant", text }];
}

export function Pane() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [cost, setCost] = useState(0);
  const [input, setInput] = useState("");
  const clientRef = useRef<EngineClient | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (clientRef.current) return; // guard React StrictMode double-invoke
    const client = new EngineClient(handleEvent, setStatus);
    clientRef.current = client;
    client.connect();
    client.send({
      type: "create_session",
      requestId: "main",
      provider: "claude",
      model: MODEL,
      cwd: ".",
    });
  }, []);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [items]);

  function handleEvent(ev: EngineEvent) {
    if (ev.type === "session_created") {
      sessionIdRef.current = ev.sessionId;
    } else if (ev.type === "agent_event") {
      const e = ev.event;
      if (e.type === "text") {
        setItems((prev) => appendAssistant(prev, e.text));
      } else if (e.type === "tool") {
        setItems((prev) => [...prev, { kind: "tool", name: e.name }]);
      } else if (e.type === "result") {
        if (e.ok) setCost((c) => c + e.costUsd);
        setItems((prev) => [...prev, { kind: "result", ...e }]);
      }
    } else if (ev.type === "error") {
      setItems((prev) => [...prev, { kind: "result", ok: false, durationMs: 0, costUsd: 0, reason: ev.message }]);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    const sessionId = sessionIdRef.current;
    if (!text || !sessionId) return;
    setItems((prev) => [...prev, { kind: "user", text }]);
    clientRef.current?.send({ type: "send_message", sessionId, text });
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
        <span className="pane-name">vibeshell — session</span>
      </div>

      <div className="feed" ref={feedRef}>
        <div className="banner">
          {MODEL} · {status === "open" ? "connected" : status}
        </div>
        {items.map((item, i) => {
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
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={sessionIdRef.current ? "Message the agent…" : "Connecting to engine…"}
        />
      </form>

      <div className="statusbar">
        <span className={`dot ${status}`} />
        <span className="model">{MODEL}</span>
        <span className="spacer" />
        <span className="cost">${cost.toFixed(4)} session</span>
      </div>
    </section>
  );
}
