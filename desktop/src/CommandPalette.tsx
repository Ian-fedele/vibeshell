import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  /** Fuzzy keywords beyond the label. */
  keywords?: string;
  disabled?: boolean;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  actions: PaletteAction[];
  onClose: () => void;
}

function score(query: string, action: PaletteAction): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const hay = `${action.label} ${action.hint ?? ""} ${action.keywords ?? ""} ${action.group ?? ""}`.toLowerCase();
  if (hay.includes(q)) return 10 + (hay.startsWith(q) ? 5 : 0);
  // Subsequence match
  let i = 0;
  for (const ch of hay) {
    if (ch === q[i]) i += 1;
    if (i >= q.length) return 3;
  }
  return 0;
}

export function CommandPalette({ open, actions, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const ranked = actions
      .map((a) => ({ a, s: score(query, a) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s || x.a.label.localeCompare(y.a.label));
    return ranked.map((x) => x.a);
  }, [actions, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, filtered]);

  if (!open) return null;

  function run(action: PaletteAction) {
    if (action.disabled) return;
    onClose();
    // Defer so the palette unmounts before dialogs/focus shifts.
    window.setTimeout(() => action.run(), 0);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const a = filtered[active];
      if (a) run(a);
    }
  }

  let lastGroup = "";

  return (
    <div className="palette-root" role="presentation" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input-row">
          <span className="palette-kicker" aria-hidden>
            ⌘K
          </span>
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a command…"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {filtered.length === 0 && (
            <div className="palette-empty">No matching commands</div>
          )}
          {filtered.map((action, idx) => {
            const showGroup = !!action.group && action.group !== lastGroup;
            if (action.group) lastGroup = action.group;
            return (
              <div key={action.id}>
                {showGroup && <div className="palette-group">{action.group}</div>}
                <button
                  type="button"
                  role="option"
                  data-idx={idx}
                  aria-selected={idx === active}
                  className={`palette-item${idx === active ? " is-active" : ""}${action.disabled ? " is-disabled" : ""}`}
                  disabled={action.disabled}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => run(action)}
                >
                  <span className="palette-label">{action.label}</span>
                  {action.hint && <span className="palette-hint">{action.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-footer">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
