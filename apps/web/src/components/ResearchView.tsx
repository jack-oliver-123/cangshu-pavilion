import { BookmarkPlus, MessageSquarePlus, Send, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ApiClient } from "../api.js";
import type { AnswerEvent, Citation, Conversation, ConversationDetail, Message } from "../types.js";

export function ResearchView(props: {
  api: ApiClient;
  notebookId: string;
  onCitation(citation: Citation): void;
  onError(error: unknown): void;
}) {
  const [conversations, setConversations] = useState<readonly Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<ConversationDetail>();
  const [question, setQuestion] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState("");

  const loadConversations = useCallback(async () => {
    try {
      const loaded = await props.api.get<readonly Conversation[]>(
        `/api/notebooks/${props.notebookId}/conversations`,
      );
      setConversations(loaded);
      setSelectedId((current) =>
        current && loaded.some((item) => item.id === current) ? current : loaded[0]?.id,
      );
    } catch (error) {
      props.onError(error);
    }
  }, [props.api, props.notebookId, props.onError]);

  const loadDetail = useCallback(
    async (id: string) => {
      try {
        setDetail(
          await props.api.get<ConversationDetail>(
            `/api/notebooks/${props.notebookId}/conversations/${id}`,
          ),
        );
      } catch (error) {
        props.onError(error);
      }
    },
    [props.api, props.notebookId, props.onError],
  );

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);
  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setDetail(undefined);
  }, [selectedId, loadDetail]);

  const createConversation = async () => {
    try {
      const created = await props.api.post<Conversation>(
        `/api/notebooks/${props.notebookId}/conversations`,
        { title: "新对话" },
      );
      await loadConversations();
      setSelectedId(created.id);
    } catch (error) {
      props.onError(error);
    }
  };

  const ask = async () => {
    const content = question.trim();
    if (!content || !selectedId || streaming) return;
    setQuestion("");
    setDraft("");
    setStreaming(true);
    try {
      await props.api.streamAnswer(
        `/api/notebooks/${props.notebookId}/conversations/${selectedId}/answer`,
        content,
        (event: AnswerEvent) => {
          if (event.type === "answer.delta") setDraft((current) => current + event.delta);
          if (event.type === "answer.completed") {
            setDetail((current) =>
              current ? { ...current, messages: [...current.messages, event.message] } : current,
            );
            setDraft("");
          }
          if (event.type === "answer.failed") props.onError(new Error(event.message));
        },
      );
      await loadDetail(selectedId);
    } catch (error) {
      props.onError(error);
    } finally {
      setStreaming(false);
    }
  };

  const saveMessage = async (message: Message) => {
    try {
      await props.api.post(`/api/notebooks/${props.notebookId}/messages/${message.id}/note`, {
        title: detail?.title ?? "研究答案",
      });
    } catch (error) {
      props.onError(error);
    }
  };

  return (
    <section className="research-layout" aria-label="资料问答">
      <aside className="conversation-list">
        <header>
          <span>对话</span>
          <button
            className="icon-button"
            type="button"
            aria-label="新建对话"
            title="新建对话"
            onClick={() => void createConversation()}
          >
            <MessageSquarePlus size={17} />
          </button>
        </header>
        {conversations.map((conversation) => (
          <button
            type="button"
            className={selectedId === conversation.id ? "active" : ""}
            key={conversation.id}
            onClick={() => setSelectedId(conversation.id)}
          >
            {conversation.title}
          </button>
        ))}
        {conversations.length === 0 ? (
          <p className="rail-empty">新建对话，从资料中寻找答案</p>
        ) : null}
      </aside>
      <div className="thread-panel">
        <header className="view-header compact">
          <div>
            <span className="eyebrow">基于资料</span>
            <h1>{detail?.title ?? "问答"}</h1>
          </div>
        </header>
        <div className="message-thread" aria-live="polite">
          {detail?.messages.map((message) => (
            <article className={`message message-${message.role}`} key={message.id}>
              <div className="message-meta">
                <span>{message.role === "researcher" ? "我" : "藏书阁"}</span>
                <span>{message.status === "failed" ? "失败" : ""}</span>
              </div>
              <div className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
              </div>
              {message.citations.length > 0 ? (
                <div className="citation-buttons">
                  {message.citations.map((citation) => (
                    <button
                      type="button"
                      key={citation.id}
                      onClick={() => props.onCitation(citation)}
                    >
                      {citation.label} · {citation.sourceTitle}
                    </button>
                  ))}
                </div>
              ) : null}
              {message.role === "assistant" && message.status === "completed" ? (
                <button
                  className="text-command"
                  type="button"
                  onClick={() => void saveMessage(message)}
                >
                  <BookmarkPlus size={15} />
                  保存为笔记
                </button>
              ) : null}
            </article>
          ))}
          {streaming ? (
            <article className="message message-assistant streaming">
              <div className="message-meta">
                <span>藏书阁</span>
                <Sparkles size={14} />
              </div>
              <div className="markdown-body">
                <ReactMarkdown>{draft || "正在检索资料..."}</ReactMarkdown>
              </div>
            </article>
          ) : null}
          {!detail && conversations.length === 0 ? (
            <div className="empty-state">
              <Sparkles size={28} />
              <h2>从资料中寻找答案</h2>
              <button
                className="primary-button"
                type="button"
                onClick={() => void createConversation()}
              >
                <MessageSquarePlus size={16} />
                新建对话
              </button>
            </div>
          ) : null}
        </div>
        {selectedId ? (
          <form
            className="question-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void ask();
            }}
          >
            <label className="sr-only" htmlFor="question">
              问题
            </label>
            <textarea
              id="question"
              rows={2}
              value={question}
              maxLength={8000}
              placeholder="向当前研究库提问"
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask();
                }
              }}
            />
            <button
              className="primary-icon"
              type="submit"
              aria-label="发送问题"
              title="发送"
              disabled={streaming || !question.trim()}
            >
              <Send size={18} />
            </button>
          </form>
        ) : null}
      </div>
    </section>
  );
}
