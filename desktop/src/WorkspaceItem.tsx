import { useState, type KeyboardEvent } from "react";
import type { Workspace } from "./store";

interface Props {
  workspace: Workspace;
  active: boolean;
  count: number;
  canDelete: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

export function WorkspaceItem({
  workspace,
  active,
  count,
  canDelete,
  onSelect,
  onRename,
  onDelete,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(workspace.name);

  const commit = () => {
    setEditing(false);
    onRename(draft);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
    else if (e.key === "Escape") {
      setDraft(workspace.name);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div className="ws-item editing">
        <input
          autoFocus
          className="ws-edit"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
        />
      </div>
    );
  }

  return (
    <div className={`ws-item${active ? " active" : ""}`}>
      <button
        className="ws-select"
        onClick={onSelect}
        onDoubleClick={() => {
          setDraft(workspace.name);
          setEditing(true);
        }}
        title="Click to switch · double-click to rename"
      >
        <span className="ws-name">{workspace.name}</span>
        <span className="ws-count">{count}</span>
      </button>
      {canDelete && (
        <button className="ws-del" onClick={onDelete} title="Delete workspace" aria-label="Delete workspace">
          ×
        </button>
      )}
    </div>
  );
}
