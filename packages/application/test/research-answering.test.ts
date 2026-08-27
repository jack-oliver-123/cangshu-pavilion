import { defineCapability, definePlugin, noConfig, startApplication } from "@cangshu/plugin-kernel";
import { describe, expect, it, vi } from "vitest";
import { RESEARCH_ANSWERING, type ResearchAnswering } from "../src/capabilities.js";
import type {
  AnswerEvent,
  Citation,
  ConversationDetail,
  Message,
  PassageCandidate,
} from "../src/domain.js";
import { researchAnsweringPlugin } from "../src/modules/research-answering.js";
import type {
  ChatModel,
  ChatModelEvent,
  ConversationRepository,
  ModelProviderResolver,
  SourceRepository,
} from "../src/ports.js";

const insufficient = "当前 Notebook 中的材料不足以可靠回答这个问题。";

describe("ResearchAnswering", () => {
  it("returns canonical insufficient evidence without calling Chat", async () => {
    const harness = await createHarness({ candidates: [] });
    const events = await collect(harness.service.answer(request()));

    expect(events.map((event) => event.type)).toEqual([
      "answer.started",
      "answer.delta",
      "answer.completed",
    ]);
    expect(events).toContainEqual({ type: "answer.delta", delta: insufficient });
    expect(harness.chatInputs).toEqual([]);
    expect(harness.messages.at(-1)).toMatchObject({
      role: "assistant",
      status: "completed",
      content: insufficient,
      citations: [],
    });
    await harness.stop();
  });

  it("rejects a Conversation from another Notebook before writes or model calls", async () => {
    const harness = await createHarness({ candidates: [], conversationNotebookId: "notebook-a" });

    await expect(
      collect(harness.service.answer(request({ notebookId: "notebook-b" }))),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(harness.messages).toEqual([]);
    expect(harness.embeddingInputs).toEqual([]);
    await harness.stop();
  });

  it("bounds diverse evidence and persists server-generated multi-Source Citations", async () => {
    const candidates = [
      ...Array.from({ length: 6 }, (_, index) => candidate("source-a", index)),
      candidate("source-b", 0),
      candidate("source-b", 1),
      candidate("source-c", 0),
    ];
    const history = Array.from({ length: 10 }, (_, index) =>
      message(index, index % 2 === 0 ? "researcher" : "assistant"),
    );
    const harness = await createHarness({
      candidates,
      history,
      chatEvents: [
        { type: "delta", delta: "Cross-source answer [P1] [P5]." },
        {
          type: "completed",
          content: "Cross-source answer [P1] [P5].",
          citedLabels: ["P1", "P5"],
        },
      ],
    });

    const events = await collect(harness.service.answer(request()));

    expect(harness.searchInputs).toEqual([
      {
        notebookId: "notebook-a",
        embedding: [1, 0],
        embeddingModel: "current-embedding",
        limit: 16,
      },
    ]);
    expect(harness.chatInputs[0]?.passages.map((passage) => passage.sourceTitle)).toEqual([
      "Source source-a",
      "Source source-a",
      "Source source-a",
      "Source source-a",
      "Source source-b",
      "Source source-b",
      "Source source-c",
    ]);
    expect(harness.chatInputs[0]?.history).toHaveLength(8);
    const citations = events.filter(
      (event): event is Extract<AnswerEvent, { type: "citation" }> => event.type === "citation",
    );
    expect(citations.map((event) => event.citation.sourceId)).toEqual(["source-a", "source-b"]);
    expect(citations[0]?.citation).toMatchObject({
      label: "P1",
      locator: candidates[0]?.locator,
      excerpt: candidates[0]?.content,
    });
    expect(harness.messages.at(-1)).toMatchObject({
      status: "completed",
      citations: expect.any(Array),
    });
    await harness.stop();
  });

  it("rejects unknown labels and citation-free fluent output authoritatively", async () => {
    for (const completed of [
      { content: "Invented [P99]", citedLabels: ["P99"] },
      { content: "Fluent but unsupported", citedLabels: [] },
    ]) {
      const harness = await createHarness({
        candidates: [candidate("source-a", 0)],
        chatEvents: [{ type: "completed", ...completed }],
      });
      const events = await collect(harness.service.answer(request()));
      const terminal = events.at(-1);
      expect(terminal).toMatchObject({
        type: "answer.completed",
        message: { content: insufficient, citations: [] },
      });
      await harness.stop();
    }
  });

  it("persists failed state after deltas and emits a redacted terminal error", async () => {
    const harness = await createHarness({
      candidates: [candidate("source-a", 0)],
      chatEvents: [
        { type: "delta", delta: "Partial text" },
        new Error("Authorization: Bearer private-key; response=secret-body"),
      ],
    });

    const events = await collect(harness.service.answer(request()));

    expect(events.map((event) => event.type)).toEqual([
      "answer.started",
      "answer.delta",
      "answer.failed",
    ]);
    expect(JSON.stringify(events.at(-1))).not.toContain("private-key");
    expect(JSON.stringify(events.at(-1))).not.toContain("secret-body");
    expect(harness.messages.at(-1)).toMatchObject({ role: "assistant", status: "failed" });
    await harness.stop();
  });

  it("marks a pending answer failed when its consumer disconnects", async () => {
    const harness = await createHarness({
      candidates: [candidate("source-a", 0)],
      chatEvents: [
        { type: "delta", delta: "Partial text" },
        { type: "completed", content: "Partial text [P1]", citedLabels: ["P1"] },
      ],
    });
    const stream = harness.service.answer(request());
    await stream.next();
    await stream.next();
    await stream.return(undefined);

    expect(harness.messages.at(-1)).toMatchObject({ role: "assistant", status: "failed" });
    await harness.stop();
  });
});

async function createHarness(input: {
  candidates: readonly PassageCandidate[];
  conversationNotebookId?: string;
  history?: readonly Message[];
  chatEvents?: readonly (ChatModelEvent | Error)[];
}) {
  const notebookId = input.conversationNotebookId ?? "notebook-a";
  const messages: Message[] = [...(input.history ?? [])];
  const conversation = {
    id: "conversation-1",
    notebookId,
    title: "Research",
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  };
  const conversations = {
    list: vi.fn(async () => [conversation]),
    find: vi.fn(async (requestedNotebookId: string, conversationId: string) =>
      requestedNotebookId === notebookId && conversationId === conversation.id
        ? ({ ...conversation, messages: [...messages] } satisfies ConversationDetail)
        : undefined,
    ),
    findMessage: vi.fn(async () => undefined),
    create: vi.fn(async () => conversation),
    addMessage: vi.fn(async (record: Parameters<ConversationRepository["addMessage"]>[0]) => {
      const created: Message = {
        id: `message-${messages.length + 1}`,
        conversationId: record.conversationId,
        role: record.role,
        status: record.status,
        content: record.content,
        citations: [],
        createdAt: new Date().toISOString(),
      };
      messages.push(created);
      return created;
    }),
    completeAssistantMessage: vi.fn(
      async (record: Parameters<ConversationRepository["completeAssistantMessage"]>[0]) => {
        const index = messages.findIndex((item) => item.id === record.messageId);
        const existing = messages[index];
        if (!existing) throw new Error("Missing pending Message");
        const citations: Citation[] = record.citations.map((citation, citationIndex) => ({
          ...citation,
          id: `citation-${citationIndex + 1}`,
          messageId: record.messageId,
        }));
        const completed: Message = {
          ...existing,
          status: "completed",
          content: record.content,
          citations,
        };
        messages[index] = completed;
        return completed;
      },
    ),
    failAssistantMessage: vi.fn(
      async (record: Parameters<ConversationRepository["failAssistantMessage"]>[0]) => {
        const index = messages.findIndex((item) => item.id === record.messageId);
        const existing = messages[index];
        if (existing) messages[index] = { ...existing, status: "failed", content: record.content };
      },
    ),
  } as unknown as ConversationRepository;
  const searchInputs: Parameters<SourceRepository["searchPassages"]>[0][] = [];
  const sources = {
    searchPassages: vi.fn(async (request) => {
      searchInputs.push(request);
      return input.candidates;
    }),
  } as unknown as SourceRepository;
  const embeddingInputs: readonly string[][] = [];
  const chatInputs: Parameters<ChatModel["stream"]>[0][] = [];
  const models: ModelProviderResolver = {
    embedding: async () => ({
      modelKey: "current-embedding",
      embed: async (texts) => {
        (embeddingInputs as string[][]).push([...texts]);
        return [[1, 0]];
      },
    }),
    chat: async () => ({
      async *stream(chatInput) {
        chatInputs.push(chatInput);
        for (const event of input.chatEvents ?? []) {
          if (event instanceof Error) throw event;
          yield event;
        }
      },
    }),
  };
  let service: ResearchAnswering | undefined;
  const capture = definePlugin({
    id: "capture-research-answering",
    provides: defineCapability<{ ready: true }>("test.capture-research-answering"),
    requires: { research: RESEARCH_ANSWERING },
    config: noConfig,
    setup({ dependencies }) {
      service = dependencies.research;
      return { ready: true as const };
    },
  });
  const application = await startApplication({
    plugins: [researchAnsweringPlugin({ conversations, sources, models }), capture],
  });
  if (!service) throw new Error("ResearchAnswering was not captured");
  return {
    service,
    messages,
    searchInputs,
    embeddingInputs,
    chatInputs,
    stop: () => application.stop(),
  };
}

async function collect(stream: AsyncGenerator<AnswerEvent>): Promise<AnswerEvent[]> {
  const events: AnswerEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function request(
  overrides: Partial<{ notebookId: string; conversationId: string; question: string }> = {},
) {
  return {
    notebookId: overrides.notebookId ?? "notebook-a",
    conversationId: overrides.conversationId ?? "conversation-1",
    question: overrides.question ?? "What is supported?",
  };
}

function candidate(sourceId: string, ordinal: number): PassageCandidate {
  const content = `Evidence ${sourceId}-${ordinal}`;
  return {
    id: `passage-${sourceId}-${ordinal}`,
    notebookId: "notebook-a",
    sourceId,
    sourceTitle: `Source ${sourceId}`,
    ordinal,
    content,
    locator: {
      kind: "text",
      startLine: ordinal + 1,
      endLine: ordinal + 1,
      characterStart: 0,
      characterEnd: content.length,
    },
    similarity: 1 - ordinal / 100,
  };
}

function message(index: number, role: Message["role"]): Message {
  return {
    id: `history-${index}`,
    conversationId: "conversation-1",
    role,
    status: "completed",
    content: `History ${index}`,
    citations: [],
    createdAt: new Date(2026, 0, index + 1).toISOString(),
  };
}
