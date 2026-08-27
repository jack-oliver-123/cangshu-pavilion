import { BookOpen, FileText, MessageSquareText, NotebookPen, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiClient, ApiError } from "./api.js";
import { type AuthenticationMode, detectAuthentication } from "./auth.js";
import { CitationViewer } from "./components/CitationViewer.js";
import { LoginView } from "./components/LoginView.js";
import { NotebookRail } from "./components/NotebookRail.js";
import { NotesView } from "./components/NotesView.js";
import { ResearchView } from "./components/ResearchView.js";
import { SettingsDialog } from "./components/SettingsDialog.js";
import { SourcesView } from "./components/SourcesView.js";
import type { Citation, Notebook } from "./types.js";

type Tab = "sources" | "research" | "notes";

export function App() {
  const api = useMemo(() => new ApiClient(), []);
  const [notebooks, setNotebooks] = useState<readonly Notebook[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [tab, setTab] = useState<Tab>("sources");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [settings, setSettings] = useState(false);
  const [citation, setCitation] = useState<Citation>();
  const [authentication, setAuthentication] = useState<AuthenticationMode | "checking">("checking");

  const onError = useCallback((caught: unknown) => {
    setError(
      caught instanceof ApiError || caught instanceof Error
        ? caught.message
        : "操作未能完成。请稍后重试。",
    );
  }, []);
  const refresh = useCallback(async () => {
    try {
      const loaded = await api.get<readonly Notebook[]>("/api/notebooks");
      setNotebooks(loaded);
      setSelectedId((current) =>
        current && loaded.some((notebook) => notebook.id === current) ? current : loaded[0]?.id,
      );
    } catch (caught) {
      onError(caught);
    } finally {
      setLoading(false);
    }
  }, [api, onError]);
  useEffect(() => {
    void detectAuthentication(api)
      .then(async (mode) => {
        setAuthentication(mode);
        if (mode !== "required") await refresh();
        else setLoading(false);
      })
      .catch((caught: unknown) => {
        setAuthentication("local");
        setLoading(false);
        onError(caught);
      });
  }, [api, onError, refresh]);

  const login = async (password: string): Promise<void> => {
    await api.post("/api/auth/login", { password });
    setAuthentication("authenticated");
    setLoading(true);
    await refresh();
  };
  const logout = async (): Promise<void> => {
    try {
      await api.post("/api/auth/logout");
      setAuthentication("required");
      setNotebooks([]);
      setSelectedId(undefined);
      setCitation(undefined);
      setSettings(false);
    } catch (caught) {
      onError(caught);
    }
  };

  if (authentication === "checking") return <LoginView checking onLogin={login} />;
  if (authentication === "required") return <LoginView onLogin={login} />;

  const selected = notebooks.find((notebook) => notebook.id === selectedId);
  const createNotebook = async (name: string) => {
    try {
      const created = await api.post<Notebook>("/api/notebooks", { name });
      await refresh();
      setSelectedId(created.id);
    } catch (caught) {
      onError(caught);
    }
  };
  const renameNotebook = async (id: string, name: string) => {
    try {
      await api.patch(`/api/notebooks/${id}`, { name });
      await refresh();
    } catch (caught) {
      onError(caught);
    }
  };
  const deleteNotebook = async (id: string) => {
    try {
      await api.delete(`/api/notebooks/${id}`);
      setCitation(undefined);
      await refresh();
    } catch (caught) {
      onError(caught);
    }
  };

  return (
    <div className={`app-shell ${citation ? "with-citation" : ""}`}>
      <NotebookRail
        notebooks={notebooks}
        selectedId={selectedId}
        loading={loading}
        onSelect={(id) => {
          setSelectedId(id);
          setCitation(undefined);
        }}
        onCreate={createNotebook}
        onRename={renameNotebook}
        onDelete={deleteNotebook}
        onSettings={() => setSettings(true)}
        {...(authentication === "authenticated" ? { onLogout: () => void logout() } : {})}
      />
      <main className="workspace">
        {selected ? (
          <>
            <header className="workspace-header">
              <div className="workspace-title">
                <span className="mobile-brand">
                  <BookOpen size={17} />
                  藏书阁
                </span>
                <h2>{selected.name}</h2>
              </div>
              <nav className="workspace-tabs" aria-label="研究库视图">
                {(
                  [
                    { id: "sources", label: "资料", icon: FileText },
                    { id: "research", label: "问答", icon: MessageSquareText },
                    { id: "notes", label: "笔记", icon: NotebookPen },
                  ] as const
                ).map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={tab === item.id ? "active" : ""}
                    onClick={() => setTab(item.id)}
                  >
                    <item.icon size={16} />
                    {item.label}
                  </button>
                ))}
              </nav>
            </header>
            <div className="workspace-content">
              {tab === "sources" ? (
                <SourcesView api={api} notebookId={selected.id} onError={onError} />
              ) : null}
              {tab === "research" ? (
                <ResearchView
                  api={api}
                  notebookId={selected.id}
                  onCitation={setCitation}
                  onError={onError}
                />
              ) : null}
              {tab === "notes" ? (
                <NotesView api={api} notebookId={selected.id} onError={onError} />
              ) : null}
            </div>
          </>
        ) : (
          <div className="workspace-empty">
            <BookOpen size={34} />
            <h1>藏书阁</h1>
            <p>{loading ? "正在加载" : "新建一个研究库开始整理资料"}</p>
          </div>
        )}
      </main>
      {citation ? (
        <CitationViewer citation={citation} onClose={() => setCitation(undefined)} />
      ) : null}
      {settings ? (
        <SettingsDialog api={api} onClose={() => setSettings(false)} onError={onError} />
      ) : null}
      {error ? (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭错误"
            title="关闭"
            onClick={() => setError(undefined)}
          >
            <X size={16} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
