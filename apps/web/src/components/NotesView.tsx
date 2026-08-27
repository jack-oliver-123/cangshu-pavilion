import { Eye, FilePlus2, Pencil, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ApiClient } from "../api.js";
import type { Note } from "../types.js";

export function NotesView(props: {
  api: ApiClient;
  notebookId: string;
  onError(error: unknown): void;
}) {
  const [notes, setNotes] = useState<readonly Note[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [baseline, setBaseline] = useState("");
  const [preview, setPreview] = useState(false);
  const dirty = `${title}\0${content}` !== baseline;

  const refresh = useCallback(async () => {
    try {
      const loaded = await props.api.get<readonly Note[]>(
        `/api/notebooks/${props.notebookId}/notes`,
      );
      setNotes(loaded);
      setSelectedId((current) =>
        current && loaded.some((note) => note.id === current) ? current : loaded[0]?.id,
      );
    } catch (error) {
      props.onError(error);
    }
  }, [props.api, props.notebookId, props.onError]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const note = notes.find((item) => item.id === selectedId);
    if (!note) {
      setTitle("");
      setContent("");
      setBaseline("");
      return;
    }
    setTitle(note.title);
    setContent(note.content);
    setBaseline(`${note.title}\0${note.content}`);
  }, [selectedId, notes]);

  const create = async () => {
    try {
      const note = await props.api.post<Note>(`/api/notebooks/${props.notebookId}/notes`, {
        title: "无标题笔记",
        content: "",
      });
      await refresh();
      setSelectedId(note.id);
    } catch (error) {
      props.onError(error);
    }
  };
  const save = async () => {
    if (!selectedId) return;
    try {
      const updated = await props.api.patch<Note>(
        `/api/notebooks/${props.notebookId}/notes/${selectedId}`,
        { title, content },
      );
      setBaseline(`${updated.title}\0${updated.content}`);
      await refresh();
    } catch (error) {
      props.onError(error);
    }
  };

  return (
    <section className="notes-layout" aria-label="Markdown 笔记">
      <aside className="note-list">
        <header>
          <span>笔记</span>
          <button
            className="icon-button"
            type="button"
            aria-label="新建笔记"
            title="新建笔记"
            onClick={() => void create()}
          >
            <FilePlus2 size={17} />
          </button>
        </header>
        {notes.map((note) => (
          <button
            type="button"
            className={selectedId === note.id ? "active" : ""}
            key={note.id}
            onClick={() => {
              if (!dirty || window.confirm("放弃未保存的修改？")) setSelectedId(note.id);
            }}
          >
            {note.title}
          </button>
        ))}
        {notes.length === 0 ? <p className="rail-empty">还没有笔记</p> : null}
      </aside>
      <div className="note-editor">
        {selectedId ? (
          <>
            <header className="editor-toolbar">
              <span className={`unsaved ${dirty ? "visible" : ""}`}>未保存</span>
              <div className="segmented">
                <button
                  type="button"
                  className={!preview ? "active" : ""}
                  aria-label="编辑笔记"
                  onClick={() => setPreview(false)}
                >
                  <Pencil size={15} />
                  编辑
                </button>
                <button
                  type="button"
                  className={preview ? "active" : ""}
                  aria-label="预览笔记"
                  onClick={() => setPreview(true)}
                >
                  <Eye size={15} />
                  预览
                </button>
              </div>
              <button
                className="icon-button danger"
                type="button"
                aria-label="删除笔记"
                title="删除"
                onClick={() => {
                  if (selectedId && window.confirm("删除这篇笔记？"))
                    void props.api
                      .delete(`/api/notebooks/${props.notebookId}/notes/${selectedId}`)
                      .then(refresh)
                      .catch(props.onError);
                }}
              >
                <Trash2 size={16} />
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={!dirty}
                onClick={() => void save()}
              >
                <Save size={16} />
                保存
              </button>
            </header>
            {preview ? (
              <div className="note-preview markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            ) : (
              <div className="editor-fields">
                <input
                  aria-label="笔记标题"
                  className="note-title-input"
                  value={title}
                  maxLength={240}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <textarea
                  aria-label="Markdown 正文"
                  value={content}
                  maxLength={2_000_000}
                  onChange={(event) => setContent(event.target.value)}
                />
              </div>
            )}
          </>
        ) : (
          <div className="empty-state">
            <FilePlus2 size={28} />
            <h2>还没有笔记</h2>
            <button className="primary-button" type="button" onClick={() => void create()}>
              <FilePlus2 size={16} />
              新建笔记
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
