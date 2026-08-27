import {
  ApplicationError,
  type NotebookManagement,
  type NoteManagement,
  type ProviderSettingsManagement,
  type ResearchAnswering,
  type SourceIngestion,
} from "@cangshu/application";
import { describe, expect, it, vi } from "vitest";
import { createHttpApp, type HttpServices } from "../src/http/http-host-plugin.js";

const notebookId = "11111111-1111-4111-8111-111111111111";
const conversationId = "33333333-3333-4333-8333-333333333333";
const message = {
  id: "44444444-4444-4444-8444-444444444444",
  conversationId,
  role: "assistant" as const,
  status: "completed" as const,
  content: "Answer [P1]",
  citations: [],
  createdAt: "2026-08-27T00:00:00.000Z",
};
const conversation = {
  id: conversationId,
  notebookId,
  title: "Research",
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

describe("Conversation and answer routes", () => {
  it("serves Conversation CRUD and named proxy-safe SSE events", async () => {
    const research = {
      listConversations: vi.fn(async () => [conversation]),
      getConversation: vi.fn(async () => ({ ...conversation, messages: [] })),
      createConversation: vi.fn(async () => conversation),
      async *answer() {
        yield { type: "answer.started" as const, messageId: message.id };
        yield { type: "answer.delta" as const, delta: "Answer [P1]" };
        yield { type: "answer.completed" as const, message };
      },
    } satisfies ResearchAnswering;
    const app = await createHttpApp(services(research));

    const created = await app.inject({
      method: "POST",
      url: `/api/notebooks/${notebookId}/conversations`,
      payload: { title: "Research" },
    });
    expect(created.statusCode).toBe(201);
    expect(research.createConversation).toHaveBeenCalledWith(notebookId, "Research");

    const response = await app.inject({
      method: "POST",
      url: `/api/notebooks/${notebookId}/conversations/${conversationId}/answer`,
      payload: { question: "What is supported?" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toContain("no-transform");
    expect(response.headers["x-accel-buffering"]).toBe("no");
    expect(response.body).toContain("event: answer.started");
    expect(response.body).toContain("event: answer.delta");
    expect(response.body).toContain("event: answer.completed");
    expect(response.body.match(/event: answer\.completed/g)).toHaveLength(1);
    await app.close();
  });

  it("emits one redacted terminal failure if the application stream throws", async () => {
    const research = {
      listConversations: vi.fn(async () => []),
      getConversation: vi.fn(),
      createConversation: vi.fn(),
      async *answer() {
        yield { type: "answer.delta" as const, delta: "Partial" };
        throw new Error("Authorization: Bearer private-key; response=secret-body");
      },
    } as unknown as ResearchAnswering;
    const app = await createHttpApp(services(research));

    const response = await app.inject({
      method: "POST",
      url: `/api/notebooks/${notebookId}/conversations/${conversationId}/answer`,
      payload: { question: "Question" },
    });
    expect(response.body).toContain("event: answer.failed");
    expect(response.body.match(/event: answer\.failed/g)).toHaveLength(1);
    expect(response.body).not.toContain("private-key");
    expect(response.body).not.toContain("secret-body");
    await app.close();
  });

  it("returns NOT_FOUND before opening SSE for a Conversation in another Notebook", async () => {
    const answer = vi.fn(async function* () {
      yield { type: "answer.started" as const, messageId: message.id };
    });
    const research = {
      listConversations: vi.fn(async () => []),
      getConversation: vi.fn(async () => {
        throw new ApplicationError({
          code: "NOT_FOUND",
          message: "Conversation was not found.",
          status: 404,
        });
      }),
      createConversation: vi.fn(),
      answer,
    } as unknown as ResearchAnswering;
    const app = await createHttpApp(services(research));

    const response = await app.inject({
      method: "POST",
      url: `/api/notebooks/${notebookId}/conversations/${conversationId}/answer`,
      payload: { question: "Question" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(answer).not.toHaveBeenCalled();
    await app.close();
  });
});

function services(research: ResearchAnswering): HttpServices {
  return {
    research,
    notebooks: {} as NotebookManagement,
    sources: {} as SourceIngestion,
    notes: {} as NoteManagement,
    providers: {} as ProviderSettingsManagement,
  };
}
