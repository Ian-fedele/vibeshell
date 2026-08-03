import type { PermissionRequest } from "./store";
import type { PermissionDecision, ToolPreview } from "./protocol";

function Preview({ preview }: { preview: ToolPreview }) {
  if (preview.kind === "edit") {
    const beforeLines = preview.before.split("\n");
    const afterLines = preview.after.split("\n");
    return (
      <div className="ap-diff">
        <div className="ap-fname">
          <span className="ap-file-badge">edit</span>
          {preview.path}
        </div>
        <div className="ap-rows">
          {beforeLines.map((line, i) => (
            <div className="ap-row del" key={`d${i}`}>
              <span className="ap-gut">−</span>
              <span className="ap-src">{line}</span>
            </div>
          ))}
          {afterLines.map((line, i) => (
            <div className="ap-row add" key={`a${i}`}>
              <span className="ap-gut">+</span>
              <span className="ap-src">{line}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (preview.kind === "write") {
    const lines = preview.content.split("\n");
    const shown = lines.slice(0, 60);
    return (
      <div className="ap-diff">
        <div className="ap-fname">
          <span className="ap-file-badge new">new</span>
          {preview.path}
        </div>
        <div className="ap-rows">
          {shown.map((line, i) => (
            <div className="ap-row add" key={i}>
              <span className="ap-gut">+</span>
              <span className="ap-src">{line}</span>
            </div>
          ))}
          {lines.length > shown.length && (
            <div className="ap-row meta">… {lines.length - shown.length} more lines</div>
          )}
        </div>
      </div>
    );
  }
  if (preview.kind === "bash") {
    return <pre className="ap-cmd">$ {preview.command}</pre>;
  }
  return <pre className="ap-cmd">{preview.summary}</pre>;
}

interface ApprovalProps {
  request: PermissionRequest;
  onDecide: (decision: PermissionDecision) => void;
}

function isFilePreview(p: ToolPreview): p is Extract<ToolPreview, { kind: "edit" | "write" }> {
  return p.kind === "edit" || p.kind === "write";
}

export function Approval({ request, onDecide }: ApprovalProps) {
  const file = isFilePreview(request.preview);
  const path =
    request.preview.kind === "edit" || request.preview.kind === "write"
      ? request.preview.path
      : null;

  return (
    <div className="approval">
      <div className="ap-head">
        {file ? (
          <>
            <span className="ap-head-title">Review file change</span>
            {path && <span className="ap-head-path">{path}</span>}
          </>
        ) : (
          <span className="ap-head-title">{request.title ?? `Allow ${request.toolName}?`}</span>
        )}
      </div>
      <Preview preview={request.preview} />
      <div className="ap-actions">
        {file ? (
          <>
            <button className="ap-btn allow" onClick={() => onDecide({ type: "allow" })}>
              Accept file
            </button>
            <button className="ap-btn always" onClick={() => onDecide({ type: "allow_always" })}>
              Always accept edits
            </button>
            <button className="ap-btn deny" onClick={() => onDecide({ type: "deny" })}>
              Reject file
            </button>
          </>
        ) : (
          <>
            <button className="ap-btn allow" onClick={() => onDecide({ type: "allow" })}>
              Allow
            </button>
            <button className="ap-btn always" onClick={() => onDecide({ type: "allow_always" })}>
              Always allow
            </button>
            <button className="ap-btn deny" onClick={() => onDecide({ type: "deny" })}>
              Deny
            </button>
          </>
        )}
      </div>
    </div>
  );
}
