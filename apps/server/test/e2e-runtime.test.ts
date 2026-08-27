import type {
  Conversation,
  ConversationDetail,
  Note,
  Notebook,
  Source,
} from "@cangshu/application";
import { describe, expect, it } from "vitest";

const configuredBaseUrl = process.env.E2E_BASE_URL;

describe.skipIf(!configuredBaseUrl)("complete research runtime", () => {
  if (!configuredBaseUrl) return;
  const baseUrl = configuredBaseUrl.replace(/\/$/u, "");

  it("imports two Sources, answers with exact cross-Source Citations, and saves an editable Note", async () => {
    const notebook = await request<Notebook>(baseUrl, "/api/notebooks", {
      method: "POST",
      body: { name: `端到端验收 ${Date.now()}` },
    });
    const first = await request<Source>(baseUrl, `/api/notebooks/${notebook.id}/sources/text`, {
      method: "POST",
      body: {
        title: "插件生命周期",
        kind: "text",
        text: "插件声明能力依赖，由内核拓扑启动，并在停止时逆序清理。",
      },
    });
    const second = await request<Source>(baseUrl, `/api/notebooks/${notebook.id}/sources/text`, {
      method: "POST",
      body: {
        title: "研究工作台",
        kind: "markdown",
        text: "研究工作台统一管理资料、带引用回答和 Markdown 笔记。",
      },
    });

    const ready = await waitForReady(baseUrl, notebook.id, [first.id, second.id]);
    expect(ready.map((source) => source.status)).toEqual(["ready", "ready"]);

    const conversation = await request<Conversation>(
      baseUrl,
      `/api/notebooks/${notebook.id}/conversations`,
      { method: "POST", body: { title: "端到端问题" } },
    );
    const answerResponse = await fetch(
      `${baseUrl}/api/notebooks/${notebook.id}/conversations/${conversation.id}/answer`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "插件与研究工作台如何配合？" }),
      },
    );
    expect(answerResponse.status).toBe(200);
    const events = await answerResponse.text();
    expect(events).toContain("event: answer.started");
    expect(events).toContain("event: citation");
    expect(events).toContain("event: answer.completed");

    const detail = await request<ConversationDetail>(
      baseUrl,
      `/api/notebooks/${notebook.id}/conversations/${conversation.id}`,
    );
    const answer = detail.messages.findLast((message) => message.role === "assistant");
    expect(answer).toMatchObject({ status: "completed" });
    expect(new Set(answer?.citations.map((citation) => citation.sourceTitle))).toEqual(
      new Set(["插件生命周期", "研究工作台"]),
    );
    expect(answer?.citations).toEqual([
      expect.objectContaining({
        label: "P1",
        excerpt: expect.any(String),
        locator: expect.any(Object),
      }),
      expect.objectContaining({
        label: "P2",
        excerpt: expect.any(String),
        locator: expect.any(Object),
      }),
    ]);

    const note = await request<Note>(
      baseUrl,
      `/api/notebooks/${notebook.id}/messages/${answer?.id}/note`,
      { method: "POST", body: { title: "端到端结论" } },
    );
    expect(note.content).toContain("## 引用");
    const updated = await request<Note>(baseUrl, `/api/notebooks/${notebook.id}/notes/${note.id}`, {
      method: "PATCH",
      body: { content: `${note.content}\n\n已复核。` },
    });
    expect(updated.content).toContain("已复核。");
  });

  it("returns the canonical insufficient-evidence answer without Citations", async () => {
    const notebook = await request<Notebook>(baseUrl, "/api/notebooks", {
      method: "POST",
      body: { name: `空白端到端验收 ${Date.now()}` },
    });
    const conversation = await request<Conversation>(
      baseUrl,
      `/api/notebooks/${notebook.id}/conversations`,
      { method: "POST", body: { title: "无资料问题" } },
    );
    const answerResponse = await fetch(
      `${baseUrl}/api/notebooks/${notebook.id}/conversations/${conversation.id}/answer`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "可以使用外部知识回答吗？" }),
      },
    );
    expect(answerResponse.status).toBe(200);
    const events = await answerResponse.text();
    expect(events).toContain("event: answer.completed");
    const detail = await request<ConversationDetail>(
      baseUrl,
      `/api/notebooks/${notebook.id}/conversations/${conversation.id}`,
    );
    const answer = detail.messages.findLast((message) => message.role === "assistant");
    expect(answer).toMatchObject({
      status: "completed",
      content: "当前 Notebook 中的材料不足以可靠回答这个问题。",
      citations: [],
    });
  });
});

async function waitForReady(
  baseUrl: string,
  notebookId: string,
  sourceIds: readonly string[],
): Promise<readonly Source[]> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const sources = await request<readonly Source[]>(
      baseUrl,
      `/api/notebooks/${notebookId}/sources`,
    );
    const selected = sourceIds.flatMap((id) => sources.filter((source) => source.id === id));
    if (
      selected.length === sourceIds.length &&
      selected.every((source) => source.status === "ready")
    ) {
      return selected;
    }
    if (selected.some((source) => source.status === "failed")) {
      throw new Error("A Source failed during the end-to-end fixture run.");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Sources did not become ready before the end-to-end timeout.");
}

async function request<T>(
  baseUrl: string,
  path: string,
  options: Readonly<{ method?: string; body?: unknown }> = {},
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    ...(options.body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(options.body),
        }),
  });
  const envelope = (await response.json()) as
    | Readonly<{ ok: true; data: T }>
    | Readonly<{ ok: false; error: Readonly<{ code: string; message: string }> }>;
  if (!response.ok || !envelope.ok) {
    throw new Error(envelope.ok ? `HTTP ${response.status}` : envelope.error.message);
  }
  return envelope.data;
}
