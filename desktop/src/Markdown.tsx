import type { ReactNode } from "react";
import {
  parseMarkdown,
  type BlockNode,
  type InlineNode,
} from "./md";

function renderInline(nodes: InlineNode[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (node.type) {
      case "text":
        return <span key={key}>{node.value}</span>;
      case "br":
        return <br key={key} />;
      case "strong":
        return <strong key={key}>{renderInline(node.children, key)}</strong>;
      case "em":
        return <em key={key}>{renderInline(node.children, key)}</em>;
      case "u":
        return <u key={key}>{renderInline(node.children, key)}</u>;
      case "del":
        return <del key={key}>{renderInline(node.children, key)}</del>;
      case "code":
        return (
          <code key={key} className="md-code">
            {node.value}
          </code>
        );
      case "link":
        return (
          <a
            key={key}
            className="md-link"
            href={node.href}
            target="_blank"
            rel="noreferrer noopener"
          >
            {renderInline(node.children, key)}
          </a>
        );
    }
  });
}

function renderBlock(block: BlockNode, index: number): ReactNode {
  const key = `b-${index}`;
  switch (block.type) {
    case "paragraph":
      return (
        <p key={key} className="md-p">
          {renderInline(block.children, key)}
        </p>
      );
    case "heading": {
      const Tag = (`h${block.level}` as "h1" | "h2" | "h3");
      return (
        <Tag key={key} className={`md-h md-h${block.level}`}>
          {renderInline(block.children, key)}
        </Tag>
      );
    }
    case "code_block":
      return (
        <pre key={key} className="md-pre" data-lang={block.lang || undefined}>
          <code>{block.value}</code>
        </pre>
      );
    case "list": {
      const ListTag = block.ordered ? "ol" : "ul";
      return (
        <ListTag key={key} className="md-list">
          {block.items.map((item, j) => (
            <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
          ))}
        </ListTag>
      );
    }
    case "blockquote":
      return (
        <blockquote key={key} className="md-quote">
          {renderInline(block.children, key)}
        </blockquote>
      );
  }
}

interface MarkdownProps {
  text: string;
  className?: string;
}

/** Render agent markdown (bold, italic, underline, code, lists, …). */
export function Markdown({ text, className }: MarkdownProps) {
  const blocks = parseMarkdown(text);
  if (blocks.length === 0) return null;
  return (
    <div className={["md", className].filter(Boolean).join(" ")}>
      {blocks.map(renderBlock)}
    </div>
  );
}
