import { ArrowLeft, ExternalLink, X } from "lucide-react";
import type { Citation } from "../types.js";

export function CitationViewer(props: { citation: Citation; onClose(): void }) {
  const locator = formatLocator(props.citation);
  return (
    <aside className="citation-viewer" aria-label="引用原文" aria-live="polite">
      <header>
        <button
          className="icon-button mobile-back"
          type="button"
          aria-label="返回回答"
          title="返回"
          onClick={props.onClose}
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <span className="eyebrow">{props.citation.label}</span>
          <h2>{props.citation.sourceTitle}</h2>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="关闭引用"
          title="关闭"
          onClick={props.onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="citation-meta">
        <span>{locator}</span>
        {props.citation.locator.kind === "web" ? (
          <a href={props.citation.locator.url} target="_blank" rel="noreferrer">
            打开网页
            <ExternalLink size={14} />
          </a>
        ) : null}
      </div>
      <div className="source-preview">
        <mark>{props.citation.excerpt}</mark>
      </div>
    </aside>
  );
}

export function formatLocator(citation: Citation): string {
  const locator = citation.locator;
  if (locator.kind === "pdf") return `第 ${locator.page} 页`;
  if (locator.kind === "web") return `第 ${locator.paragraph} 段`;
  return `第 ${locator.startLine}-${locator.endLine} 行`;
}
