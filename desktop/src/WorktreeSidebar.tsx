import type { WorktreeListItem } from "./protocol";

interface WorktreeSidebarProps {
  items: WorktreeListItem[];
  loading: boolean;
  projectLabel: string;
  onRefresh: () => void;
  onMerge: (branch: string) => void;
  onDiscard: (branch: string) => void;
}

export function WorktreeSidebar({
  items,
  loading,
  projectLabel,
  onRefresh,
  onMerge,
  onDiscard,
}: WorktreeSidebarProps) {
  return (
    <div className="wt-block">
      <div className="wt-head">
        <span>Isolates</span>
        <button
          type="button"
          className="icon-btn"
          onClick={onRefresh}
          title="Refresh worktrees"
          aria-label="Refresh worktrees"
          disabled={loading}
        >
          ↻
        </button>
      </div>
      {items.length === 0 ? (
        <div className="wt-empty">
          {loading ? "Loading…" : `No vibeshell/* branches in ${projectLabel}`}
        </div>
      ) : (
        <ul className="wt-list">
          {items.map((it) => (
            <li key={it.branch} className="wt-item">
              <div className="wt-item-main">
                <span className="wt-branch" title={it.path ?? it.branch}>
                  {it.branch.replace(/^vibeshell\//, "")}
                </span>
                <span className="wt-meta">
                  {typeof it.commits === "number" && it.commits > 0 && (
                    <span title="Commits ahead of HEAD">+{it.commits}</span>
                  )}
                  {it.dirty && <span className="wt-dirty" title="Uncommitted changes">•</span>}
                  {it.path ? (
                    <span className="wt-live" title={it.path}>
                      live
                    </span>
                  ) : (
                    <span className="wt-branch-only">branch</span>
                  )}
                </span>
              </div>
              <div className="wt-actions">
                <button
                  type="button"
                  className="wt-btn merge"
                  onClick={() => onMerge(it.branch)}
                  title={`Merge ${it.branch} into current branch`}
                >
                  Merge
                </button>
                <button
                  type="button"
                  className="wt-btn discard"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Discard ${it.branch}? This removes the worktree and deletes the branch.`,
                      )
                    ) {
                      onDiscard(it.branch);
                    }
                  }}
                  title="Remove worktree and delete branch"
                >
                  Discard
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
