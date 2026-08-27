import { defineCapability, definePlugin, noConfig, startApplication } from "@cangshu/plugin-kernel";
import { describe, expect, it, vi } from "vitest";
import { NOTE_MANAGEMENT, type NoteManagement } from "../src/capabilities.js";
import type { Message, Note } from "../src/domain.js";
import { noteManagementPlugin } from "../src/modules/note-management.js";
import type { ConversationRepository, NoteRepository } from "../src/ports.js";

describe("NoteManagement", () => {
  it("projects a completed cited answer to Markdown with immutable provenance", async () => {
    const answer = completedAnswer();
    const harness = await createHarness(answer);

    const note = await harness.service.saveAnswer({
      notebookId: "notebook-a",
      messageId: answer.id,
      title: "  Evidence note  ",
    });

    expect(note).toMatchObject({
      notebookId: "notebook-a",
      title: "Evidence note",
      sourceMessageId: answer.id,
    });
    expect(note.content).toContain("Authoritative answer [P1] [P2].");
    expect(note.content).toContain("## 引用");
    expect(note.content).toContain("[P1] **Source A**，第 3 页");
    expect(note.content).toContain("> Exact excerpt A");

    await harness.service.update("notebook-a", note.id, { content: "Independent edit" });
    expect(answer.content).toBe("Authoritative answer [P1] [P2].");
    expect(answer.citations).toHaveLength(2);
    expect((await harness.service.get("notebook-a", note.id)).content).toBe("Independent edit");
    await harness.stop();
  });

  it("allows insufficient evidence but rejects ineligible Messages and cross-Notebook access", async () => {
    const insufficient: Message = {
      ...completedAnswer(),
      id: "message-insufficient",
      content: "当前 Notebook 中的材料不足以可靠回答这个问题。",
      citations: [],
    };
    const harness = await createHarness(insufficient);
    const note = await harness.service.saveAnswer({
      notebookId: "notebook-a",
      messageId: insufficient.id,
    });
    expect(note.content).toBe(insufficient.content);
    expect(note.content).not.toContain("## 引用");

    for (const message of [
      { ...insufficient, id: "pending", status: "pending" as const },
      { ...insufficient, id: "failed", status: "failed" as const },
      { ...insufficient, id: "researcher", role: "researcher" as const },
    ]) {
      harness.messages.set(message.id, message);
      await expect(
        harness.service.saveAnswer({ notebookId: "notebook-a", messageId: message.id }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    }
    await expect(
      harness.service.saveAnswer({ notebookId: "notebook-b", messageId: insufficient.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(harness.createdNotes).toHaveLength(1);
    await harness.stop();
  });
});

async function createHarness(initialMessage: Message) {
  const messages = new Map<string, Message>([[initialMessage.id, initialMessage]]);
  const createdNotes: Note[] = [];
  const notes = {
    list: vi.fn(async (notebookId: string) =>
      createdNotes.filter((note) => note.notebookId === notebookId),
    ),
    find: vi.fn(async (notebookId: string, noteId: string) =>
      createdNotes.find((note) => note.notebookId === notebookId && note.id === noteId),
    ),
    create: vi.fn(async (input: Parameters<NoteRepository["create"]>[0]) => {
      const note: Note = {
        id: `note-${createdNotes.length + 1}`,
        notebookId: input.notebookId,
        title: input.title,
        content: input.content,
        createdAt: "2026-08-27T00:00:00.000Z",
        updatedAt: "2026-08-27T00:00:00.000Z",
        ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
      };
      createdNotes.push(note);
      return note;
    }),
    update: vi.fn(async (notebookId: string, noteId: string, changes: Partial<Note>) => {
      const index = createdNotes.findIndex(
        (note) => note.notebookId === notebookId && note.id === noteId,
      );
      const existing = createdNotes[index];
      if (!existing) return undefined;
      const updated = { ...existing, ...changes, updatedAt: "2026-08-27T01:00:00.000Z" };
      createdNotes[index] = updated;
      return updated;
    }),
    delete: vi.fn(async (notebookId: string, noteId: string) => {
      const index = createdNotes.findIndex(
        (note) => note.notebookId === notebookId && note.id === noteId,
      );
      if (index < 0) return false;
      createdNotes.splice(index, 1);
      return true;
    }),
  } as unknown as NoteRepository;
  const conversations = {
    findMessage: vi.fn(async (notebookId: string, messageId: string) =>
      notebookId === "notebook-a" ? messages.get(messageId) : undefined,
    ),
  } as unknown as ConversationRepository;
  let service: NoteManagement | undefined;
  const capture = definePlugin({
    id: "capture-note-management",
    provides: defineCapability<{ ready: true }>("test.capture-note-management"),
    requires: { notes: NOTE_MANAGEMENT },
    config: noConfig,
    setup({ dependencies }) {
      service = dependencies.notes;
      return { ready: true as const };
    },
  });
  const application = await startApplication({
    plugins: [noteManagementPlugin({ notes, conversations }), capture],
  });
  if (!service) throw new Error("NoteManagement was not captured");
  return {
    service,
    messages,
    createdNotes,
    stop: () => application.stop(),
  };
}

function completedAnswer(): Message {
  return {
    id: "message-answer",
    conversationId: "conversation-1",
    role: "assistant",
    status: "completed",
    content: "Authoritative answer [P1] [P2].",
    createdAt: "2026-08-27T00:00:00.000Z",
    citations: [
      {
        id: "citation-1",
        messageId: "message-answer",
        passageId: "passage-1",
        sourceId: "source-1",
        sourceTitle: "Source A",
        label: "P1",
        locator: { kind: "pdf", page: 3, characterStart: 0, characterEnd: 15 },
        excerpt: "Exact excerpt A",
      },
      {
        id: "citation-2",
        messageId: "message-answer",
        passageId: "passage-2",
        sourceId: "source-2",
        sourceTitle: "Source B",
        label: "P2",
        locator: {
          kind: "web",
          url: "https://example.com",
          paragraph: 4,
          characterStart: 0,
          characterEnd: 15,
        },
        excerpt: "Exact excerpt B",
      },
    ],
  };
}
