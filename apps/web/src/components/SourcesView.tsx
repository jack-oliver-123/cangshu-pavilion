import {
  FileText,
  Globe2,
  Link,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../api.js";
import { messages } from "../messages.js";
import type { Source } from "../types.js";
import { SourceFailureDetail } from "./SourceFailureDetail.js";

type ImportMode = "file" | "url" | "text";

export function SourcesView(props: {
  api: ApiClient;
  notebookId: string;
  onError(error: unknown): void;
}) {
  const [sources, setSources] = useState<readonly Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ImportMode>();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [markdown, setMarkdown] = useState(false);
  const [file, setFile] = useState<File>();
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSources(
        await props.api.get<readonly Source[]>(`/api/notebooks/${props.notebookId}/sources`),
      );
    } catch (error) {
      props.onError(error);
    } finally {
      setLoading(false);
    }
  }, [props.api, props.notebookId, props.onError]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!sources.some((source) => ["queued", "extracting", "indexing"].includes(source.status)))
      return;
    const timer = window.setInterval(() => void refresh(), 4_000);
    return () => window.clearInterval(timer);
  }, [sources, refresh]);

  const submit = async () => {
    if (!mode) return;
    setSubmitting(true);
    try {
      if (mode === "file" && file) {
        const form = new FormData();
        form.append("title", title || file.name);
        form.append("file", file);
        await props.api.upload(`/api/notebooks/${props.notebookId}/sources/upload`, form);
      } else if (mode === "url") {
        await props.api.post(`/api/notebooks/${props.notebookId}/sources/url`, {
          url,
          ...(title.trim() ? { title } : {}),
        });
      } else if (mode === "text") {
        await props.api.post(`/api/notebooks/${props.notebookId}/sources/text`, {
          title,
          text,
          kind: markdown ? "markdown" : "text",
        });
      }
      setMode(undefined);
      setTitle("");
      setUrl("");
      setText("");
      setFile(undefined);
      await refresh();
    } catch (error) {
      props.onError(error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="view-band sources-view" aria-labelledby="sources-heading">
      <header className="view-header">
        <div>
          <span className="eyebrow">资料库</span>
          <h1 id="sources-heading">{messages.sources}</h1>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            type="button"
            aria-label={`${messages.refresh}${messages.sources}`}
            title={messages.refresh}
            onClick={() => void refresh()}
          >
            <RefreshCw size={17} />
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => setMode(mode ? undefined : "file")}
          >
            <Plus size={16} />
            导入资料
          </button>
        </div>
      </header>

      {mode ? (
        <div className="import-panel">
          <fieldset className="segmented" aria-label="导入方式">
            <button
              type="button"
              className={mode === "file" ? "active" : ""}
              onClick={() => setMode("file")}
            >
              <Upload size={15} />
              文件
            </button>
            <button
              type="button"
              className={mode === "url" ? "active" : ""}
              onClick={() => setMode("url")}
            >
              <Link size={15} />
              网页
            </button>
            <button
              type="button"
              className={mode === "text" ? "active" : ""}
              onClick={() => setMode("text")}
            >
              <FileText size={15} />
              文本
            </button>
          </fieldset>
          <button
            className="icon-button import-close"
            type="button"
            aria-label="关闭导入"
            title="关闭"
            onClick={() => setMode(undefined)}
          >
            <X size={17} />
          </button>
          <div className="form-grid">
            <label>
              标题
              <input
                value={title}
                maxLength={240}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={mode === "file" ? "默认使用文件名" : "资料标题"}
              />
            </label>
            {mode === "file" ? (
              <label>
                文件
                <input
                  type="file"
                  accept=".pdf,.txt,.md,.markdown,text/plain,text/markdown,application/pdf"
                  onChange={(event) => setFile(event.target.files?.[0])}
                />
              </label>
            ) : null}
            {mode === "url" ? (
              <label>
                网址
                <input
                  type="url"
                  required
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://"
                />
              </label>
            ) : null}
            {mode === "text" ? (
              <label className="wide-field">
                正文
                <textarea
                  value={text}
                  maxLength={5 * 1024 * 1024}
                  rows={7}
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
            ) : null}
            {mode === "text" ? (
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={markdown}
                  onChange={(event) => setMarkdown(event.target.checked)}
                />
                Markdown
              </label>
            ) : null}
          </div>
          <div className="form-actions">
            <button
              className="primary-button"
              type="button"
              disabled={submitting || (mode === "file" && !file)}
              onClick={() => void submit()}
            >
              {submitting ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}导入
            </button>
          </div>
        </div>
      ) : null}

      <div className="source-table" aria-busy={loading}>
        {sources.map((source) => (
          <article className="source-row" key={source.id}>
            <span className="source-icon" aria-hidden="true">
              {source.kind === "web" ? <Globe2 size={18} /> : <FileText size={18} />}
            </span>
            <div className="source-main">
              <h2>{source.title}</h2>
              <p>
                {source.kind.toUpperCase()} · {source.passageCount} 个片段
              </p>
              {source.failure ? <SourceFailureDetail failure={source.failure} /> : null}
            </div>
            <span className={`status status-${source.status}`}>
              {["queued", "extracting", "indexing"].includes(source.status) ? (
                <LoaderCircle className="spin" size={13} />
              ) : null}
              {messages.sourceStatus[source.status]}
            </span>
            <span className="row-actions always">
              {source.failure?.retryable ? (
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`重试 ${source.title}`}
                  title={messages.retry}
                  onClick={() =>
                    void props.api
                      .post(`/api/notebooks/${props.notebookId}/sources/${source.id}/retry`)
                      .then(refresh)
                      .catch(props.onError)
                  }
                >
                  <RotateCcw size={15} />
                </button>
              ) : null}
              <button
                className="icon-button danger"
                type="button"
                aria-label={`删除 ${source.title}`}
                title={messages.delete}
                onClick={() => {
                  if (window.confirm(`删除“${source.title}”？`))
                    void props.api
                      .delete(`/api/notebooks/${props.notebookId}/sources/${source.id}`)
                      .then(refresh)
                      .catch(props.onError);
                }}
              >
                <Trash2 size={15} />
              </button>
            </span>
          </article>
        ))}
        {!loading && sources.length === 0 ? (
          <div className="empty-state">
            <FileText size={28} />
            <h2>{messages.emptySources}</h2>
            <p>导入 PDF、网页、TXT 或 Markdown</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
