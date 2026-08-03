import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { DiffFile } from "./protocol";

interface ReviewPanelProps {
  open: boolean;
  title: string;
  files: DiffFile[];
  loading: boolean;
  canRestore: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onRejectPaths: (paths: string[]) => void;
}

function PatchView({ patch }: { patch: string }) {
  if (!patch.trim()) {
    return <div className="review-empty-patch">No textual diff for this file.</div>;
  }
  return (
    <pre className="review-patch">
      {patch.split("\n").map((line, i) => {
        let cls = "pl";
        if (line.startsWith("+++") || line.startsWith("---")) cls = "pl meta";
        else if (line.startsWith("@@")) cls = "pl hunk";
        else if (line.startsWith("+")) cls = "pl add";
        else if (line.startsWith("-")) cls = "pl del";
        return (
          <div className={cls} key={i}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

export function ReviewPanel({
  open,
  title,
  files,
  loading,
  canRestore,
  onClose,
  onRefresh,
  onRejectPaths,
}: ReviewPanelProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setSelected(files[0]?.path ?? null);
    setChecked([]);
  }, [open, files]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const active = useMemo(
    () => files.find((f) => f.path === selected) ?? files[0] ?? null,
    [files, selected],
  );

  if (!open) return null;

  function toggle(path: string) {
    setChecked((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));
  }

  function toggleAll() {
    if (checked.length === files.length) setChecked([]);
    else setChecked(files.map((f) => f.path));
  }

  const rejectTargets = checked.length > 0 ? checked : active ? [active.path] : [];

  const ui = (
    <div className="review-root" role="dialog" aria-modal="true" aria-label="Session review">
      <button type="button" className="review-backdrop" aria-label="Close review" onClick={onClose} />
      <div className="review-panel">
        <header className="review-head">
          <div>
            <div className="review-kicker">Review</div>
            <h2 className="review-title">{title}</h2>
            {loading && <div className="review-loading">Loading working-tree diff…</div>}
          </div>
          <div className="review-head-actions">
            <button type="button" className="review-btn ghost" onClick={onRefresh} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </button>
            <button type="button" className="review-btn ghost" onClick={onClose} aria-label="Close review">
              ×
            </button>
          </div>
        </header>

        {!loading && files.length === 0 ? (
          <div className="review-empty">Working tree is clean — no file changes vs HEAD.</div>
        ) : (
          <div className="review-body">
            <aside className="review-files">
              <div className="review-files-head">
                <button type="button" className="review-link" onClick={toggleAll}>
                  {checked.length === files.length && files.length > 0 ? "Clear" : "Select all"}
                </button>
                <span className="review-count">
                  {loading && files.length === 0 ? "…" : `${files.length} files`}
                </span>
              </div>
              <ul>
                {files.map((f) => (
                  <li key={f.path}>
                    <label className={`review-file${active?.path === f.path ? " is-active" : ""}`}>
                      <input
                        type="checkbox"
                        checked={checked.includes(f.path)}
                        onChange={() => toggle(f.path)}
                      />
                      <button
                        type="button"
                        className="review-file-btn"
                        onClick={() => setSelected(f.path)}
                      >
                        <span className={`review-status st-${f.status}`}>
                          {f.status[0]?.toUpperCase()}
                        </span>
                        <span className="review-file-path">{f.path}</span>
                        <span className="review-stats">
                          <span className="add">+{f.additions}</span>
                          <span className="del">−{f.deletions}</span>
                        </span>
                      </button>
                    </label>
                  </li>
                ))}
              </ul>
            </aside>
            <section className="review-diff">
              {active ? (
                <>
                  <div className="review-diff-head">
                    <span className="review-diff-path">{active.path}</span>
                    <span className={`review-status st-${active.status}`}>{active.status}</span>
                  </div>
                  <PatchView patch={active.patch} />
                </>
              ) : (
                <div className="review-empty">
                  {loading ? "Fetching diff from engine…" : "Select a file"}
                </div>
              )}
            </section>
          </div>
        )}

        <footer className="review-foot">
          <span className="review-foot-hint">
            {canRestore
              ? "Reject restores from the last turn checkpoint when possible."
              : "Reject restores from HEAD (no turn checkpoint)."}
          </span>
          <div className="review-foot-actions">
            <button
              type="button"
              className="review-btn deny"
              disabled={rejectTargets.length === 0 || loading}
              onClick={() => onRejectPaths(rejectTargets)}
              title="Restore selected files"
            >
              Reject {rejectTargets.length > 1 ? `${rejectTargets.length} files` : "file"}
            </button>
            <button type="button" className="review-btn allow" onClick={onClose}>
              Keep changes
            </button>
          </div>
        </footer>
      </div>
    </div>
  );

  // Portal escapes pane overflow / stacking contexts in the Tauri webview.
  return createPortal(ui, document.body);
}
