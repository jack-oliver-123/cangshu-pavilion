import { BookOpen, Check, LogOut, Pencil, Plus, Settings, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { Notebook } from "../types.js";

export function NotebookRail(props: {
  notebooks: readonly Notebook[];
  selectedId: string | undefined;
  loading: boolean;
  onSelect(id: string): void;
  onCreate(name: string): Promise<void>;
  onRename(id: string, name: string): Promise<void>;
  onDelete(id: string): Promise<void>;
  onSettings(): void;
  onLogout?: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [editingName, setEditingName] = useState("");

  return (
    <aside className="notebook-rail" aria-label="研究库导航">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">
          <BookOpen size={19} />
        </span>
        <strong>藏书阁</strong>
      </div>
      <div className="rail-heading">
        <span>研究库</span>
        <button
          className="icon-button"
          type="button"
          aria-label="新建研究库"
          title="新建研究库"
          onClick={() => setCreating(true)}
        >
          <Plus size={17} />
        </button>
      </div>
      {creating ? (
        <form
          className="inline-create"
          onSubmit={(event) => {
            event.preventDefault();
            void props.onCreate(name).then(() => {
              setName("");
              setCreating(false);
            });
          }}
        >
          <label className="sr-only" htmlFor="new-notebook">
            研究库名称
          </label>
          <input
            id="new-notebook"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
          <button className="icon-button" type="submit" aria-label="确认新建" title="确认新建">
            <Check size={16} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="取消新建"
            title="取消"
            onClick={() => setCreating(false)}
          >
            <X size={16} />
          </button>
        </form>
      ) : null}
      <nav className="notebook-list">
        {props.notebooks.map((notebook) => (
          <div
            className={`notebook-row ${props.selectedId === notebook.id ? "is-selected" : ""}`}
            key={notebook.id}
          >
            {editingId === notebook.id ? (
              <form
                className="inline-create"
                onSubmit={(event) => {
                  event.preventDefault();
                  void props.onRename(notebook.id, editingName).then(() => setEditingId(undefined));
                }}
              >
                <input
                  aria-label="研究库新名称"
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                />
                <button className="icon-button" type="submit" aria-label="保存名称" title="保存">
                  <Check size={15} />
                </button>
              </form>
            ) : (
              <>
                <button
                  className="notebook-select"
                  type="button"
                  onClick={() => props.onSelect(notebook.id)}
                >
                  {notebook.name}
                </button>
                <span className="row-actions">
                  <button
                    className="icon-button subtle"
                    type="button"
                    aria-label={`重命名 ${notebook.name}`}
                    title="重命名"
                    onClick={() => {
                      setEditingId(notebook.id);
                      setEditingName(notebook.name);
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="icon-button subtle danger"
                    type="button"
                    aria-label={`删除 ${notebook.name}`}
                    title="删除"
                    onClick={() => {
                      if (window.confirm(`删除“${notebook.name}”及其中全部内容？`))
                        void props.onDelete(notebook.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              </>
            )}
          </div>
        ))}
        {!props.loading && props.notebooks.length === 0 ? (
          <p className="rail-empty">新建一个研究库开始整理资料</p>
        ) : null}
      </nav>
      <div className="rail-footer">
        <button className="rail-settings" type="button" onClick={props.onSettings}>
          <Settings size={16} />
          模型设置
        </button>
        {props.onLogout ? (
          <button
            className="rail-logout icon-button"
            type="button"
            aria-label="退出登录"
            title="退出登录"
            onClick={props.onLogout}
          >
            <LogOut size={16} />
          </button>
        ) : null}
      </div>
    </aside>
  );
}
