import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { Pane as PaneState } from "./store";

interface TerminalPaneProps {
  pane: PaneState;
  onClose: () => void;
  onWrite: (terminalId: string, data: string) => void;
  onResize: (terminalId: string, cols: number, rows: number) => void;
  onSubscribe: (
    paneId: string,
    terminalId: string | null,
    cb: (data: string) => void,
  ) => () => void;
  onRestart: (paneId: string, cols: number, rows: number) => void;
  onEnsure: (paneId: string, cols: number, rows: number) => void;
}

/**
 * Interactive shell pane backed by engine node-pty + xterm.js.
 * PTY bytes bypass the React store (high frequency); only bind/exit state
 * lives in the pane model.
 */
export function TerminalPane({
  pane,
  onClose,
  onWrite,
  onResize,
  onSubscribe,
  onRestart,
  onEnsure,
}: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<string | null>(pane.terminalId);
  terminalIdRef.current = pane.terminalId;

  // Create xterm once per mount.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        'ui-monospace, "SF Mono", "SFMono-Regular", "JetBrains Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      theme: {
        background: "#0e1118",
        foreground: "#d5dbe6",
        cursor: "#4fd1c5",
        cursorAccent: "#0e1118",
        selectionBackground: "rgba(79, 209, 197, 0.28)",
        black: "#1a1f2b",
        red: "#e56a6c",
        green: "#6cc177",
        yellow: "#e8b34a",
        blue: "#6aa6ff",
        magenta: "#c792ea",
        cyan: "#4fd1c5",
        white: "#d5dbe6",
        brightBlack: "#6b7384",
        brightRed: "#ff8b8d",
        brightGreen: "#8fd99a",
        brightYellow: "#f0c674",
        brightBlue: "#8cbcff",
        brightMagenta: "#d7a6f5",
        brightCyan: "#7ee0d6",
        brightWhite: "#ffffff",
      },
      allowProposedApi: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const onDataDisp = term.onData((data) => {
      const id = terminalIdRef.current;
      if (id) onWrite(id, data);
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        const id = terminalIdRef.current;
        if (id && term.cols && term.rows) {
          onResize(id, term.cols, term.rows);
        }
      } catch {
        // xterm can throw if disposed mid-resize
      }
    });
    ro.observe(host);

    // Ensure a PTY exists at the fitted size.
    onEnsure(pane.id, term.cols || 80, term.rows || 24);

    // Focus so keystrokes work immediately.
    term.focus();

    return () => {
      onDataDisp.dispose();
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once per pane
  }, [pane.id]);

  // Stream PTY output into xterm. Subscribe once per pane mount — keyed by
  // paneId so bind/restart does not re-register and double-echo.
  useEffect(() => {
    const write = (data: string) => {
      termRef.current?.write(data);
    };
    return onSubscribe(pane.id, pane.terminalId, write);
  }, [pane.id, onSubscribe]);

  // When a new PTY binds after restart, push size + focus.
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !pane.terminalId) return;
    try {
      fit?.fit();
      onResize(pane.terminalId, term.cols || 80, term.rows || 24);
      term.focus();
    } catch {
      // ignore
    }
  }, [pane.terminalId, onResize]);

  const ready = pane.terminalId !== null;
  const failed = !ready && !!pane.lastError;
  const exited = !ready && pane.terminalExitCode !== null && !failed;

  return (
    <section className={`pane pane-terminal${ready ? " is-live" : ""}`}>
      <div className="pane-title">
        <span className="pane-provider-bar" aria-hidden />
        <span className="lights">
          <i />
          <i />
          <i />
        </span>
        <span className="pane-name">{pane.title}</span>
        <span className="pane-provider-badge provider-terminal" title="Interactive shell">
          shell
        </span>
        {ready && (
          <span className="pane-live" title="Shell connected">
            <span className="pane-live-dot" />
            live
          </span>
        )}
        {exited && (
          <span className="pane-term-exit" title="Shell process ended">
            exited
            {pane.terminalExitCode !== null && pane.terminalExitCode !== 0
              ? ` · ${pane.terminalExitCode}`
              : ""}
          </span>
        )}
        {failed && (
          <span className="pane-term-exit pane-term-error" title={pane.lastError ?? "error"}>
            error
          </span>
        )}
        <span className="pane-title-spacer" />
        <button
          className="pane-undo"
          onClick={() => {
            const term = termRef.current;
            const cols = term?.cols || 80;
            const rows = term?.rows || 24;
            term?.reset();
            onRestart(pane.id, cols, rows);
          }}
          title="Restart shell"
        >
          ↻ restart
        </button>
        <button className="pane-close" onClick={onClose} title="Close terminal" aria-label="Close terminal">
          ×
        </button>
      </div>

      {failed && (
        <div className="term-error-banner" role="alert">
          <div className="term-error-title">Couldn’t start shell</div>
          <div className="term-error-body">{pane.lastError}</div>
          <button
            type="button"
            className="term-error-retry"
            onClick={() => {
              const term = termRef.current;
              term?.reset();
              onRestart(pane.id, term?.cols || 80, term?.rows || 24);
            }}
          >
            Retry
          </button>
        </div>
      )}

      <div
        className="term-host"
        ref={hostRef}
        onClick={() => termRef.current?.focus()}
        role="application"
        aria-label={`${pane.title} terminal`}
      />

      <div className="statusbar">
        <span
          className={`dot ${ready ? "live" : failed ? "closed" : exited ? "closed" : "connecting"}`}
        />
        <span className="model" title="Interactive PTY shell">
          terminal
        </span>
        {!ready && !exited && !failed && <span className="status-live">connecting…</span>}
        {failed && <span className="status-live">spawn failed</span>}
        {exited && <span className="status-live">shell ended</span>}
        <span className="spacer" />
        <span className="cost">{ready ? "pty" : "—"}</span>
      </div>
    </section>
  );
}
