import type { PermissionRequest } from "./store";
import type { PermissionDecision, ToolPreview } from "./protocol";

function Preview({ preview }: { preview: ToolPreview }) {
  if (preview.kind === "edit") {
    return (
      <div className="ap-diff">
        <div className="ap-fname">{preview.path}</div>
        <div className="ap-rows">
          {preview.before.split("\n").map((line, i) => (
            <div className="ap-row del" key={`d${i}`}>
              <span className="ap-gut">-</span>
              <span className="ap-src">{line}</span>
            </div>
          ))}
          {preview.after.split("\n").map((line, i) => (
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
    return (
      <div className="ap-diff">
        <div className="ap-fname">{preview.path} (new file)</div>
        <div className="ap-rows">
          {preview.content
            .split("\n")
            .slice(0, 40)
            .map((line, i) => (
              <div className="ap-row add" key={i}>
                <span className="ap-gut">+</span>
                <span className="ap-src">{line}</span>
              </div>
            ))}
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

export function Approval({ request, onDecide }: ApprovalProps) {
  return (
    <div className="approval">
      <div className="ap-head">{request.title ?? `Allow ${request.toolName}?`}</div>
      <Preview preview={request.preview} />
      <div className="ap-actions">
        <button className="ap-btn allow" onClick={() => onDecide({ type: "allow" })}>
          Allow
        </button>
        <button className="ap-btn always" onClick={() => onDecide({ type: "allow_always" })}>
          Always allow
        </button>
        <button className="ap-btn deny" onClick={() => onDecide({ type: "deny" })}>
          Deny
        </button>
      </div>
    </div>
  );
}
