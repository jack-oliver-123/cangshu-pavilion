import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectDatabase } from "../src/database/client.js";
import { migrateDatabase } from "../src/database/migrate.js";
import {
  PostgresConversationRepository,
  PostgresNotebookRepository,
  PostgresNoteRepository,
  PostgresSourceRepository,
} from "../src/database/repositories.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("PostgreSQL Repository contracts", () => {
  if (!databaseUrl) {
    return;
  }

  const connection = connectDatabase(databaseUrl);
  const notebooks = new PostgresNotebookRepository(connection.db);
  const sources = new PostgresSourceRepository(connection.db);
  const conversations = new PostgresConversationRepository(connection.db);
  const notes = new PostgresNoteRepository(connection.db);

  beforeAll(async () => {
    await migrateDatabase(databaseUrl);
  });

  beforeEach(async () => {
    await connection.db.execute(sql`truncate table notebooks cascade`);
  });

  afterAll(async () => {
    await connection.close();
  });

  it("only releases a content-addressed blob after its final Source is deleted", async () => {
    const firstNotebook = await notebooks.create("第一本");
    const secondNotebook = await notebooks.create("第二本");
    const first = await sources.create({
      notebookId: firstNotebook.id,
      title: "共同材料 A",
      kind: "text",
      mimeType: "text/plain",
      contentHash: "a".repeat(64),
      storageKey: "sha256/aa/shared",
      sizeBytes: 12,
    });
    const second = await sources.create({
      notebookId: secondNotebook.id,
      title: "共同材料 B",
      kind: "text",
      mimeType: "text/plain",
      contentHash: "a".repeat(64),
      storageKey: "sha256/aa/shared",
      sizeBytes: 12,
    });
    const webpage = await sources.create({
      notebookId: firstNotebook.id,
      title: "网页",
      kind: "web",
      mimeType: "text/html",
      originalUrl: "https://example.com/article",
    });

    await expect(sources.delete(firstNotebook.id, first.id)).resolves.toEqual({ deleted: true });
    await expect(sources.delete(firstNotebook.id, webpage.id)).resolves.toEqual({ deleted: true });
    await expect(sources.delete(secondNotebook.id, second.id)).resolves.toEqual({
      deleted: true,
      unreferencedStorageKey: "sha256/aa/shared",
    });
    await expect(sources.delete(secondNotebook.id, second.id)).resolves.toEqual({ deleted: false });
  });

  it("commits Source status, Passages, and processing Attempts atomically", async () => {
    const notebook = await notebooks.create("事务研究");
    const source = await sources.create({
      notebookId: notebook.id,
      title: "事务材料",
      kind: "text",
      mimeType: "text/plain",
      contentHash: "b".repeat(64),
      storageKey: "sha256/bb/source",
      sizeBytes: 20,
    });

    await sources.markStatus(notebook.id, source.id, "extracting");
    await sources.markStatus(notebook.id, source.id, "indexing");
    await sources.complete(notebook.id, source.id, [
      {
        ordinal: 0,
        content: "可靠的旧 Passage",
        locator: {
          kind: "text",
          startLine: 1,
          endLine: 1,
          characterStart: 0,
          characterEnd: 13,
        },
        tokenEstimate: 4,
        embedding: [1, 0],
        embeddingModel: "model-a",
      },
    ]);

    expect(await sources.find(notebook.id, source.id)).toMatchObject({
      status: "ready",
      passageCount: 1,
    });
    expect(await sources.listAttempts(notebook.id, source.id)).toEqual([
      expect.objectContaining({ status: "completed" }),
    ]);

    await sources.markQueued(notebook.id, source.id);
    await sources.markStatus(notebook.id, source.id, "extracting");
    await sources.markStatus(notebook.id, source.id, "indexing");
    await expect(
      sources.complete(notebook.id, source.id, [
        {
          ordinal: 0,
          content: "将被回滚的新 Passage",
          locator: {
            kind: "text",
            startLine: 2,
            endLine: 2,
            characterStart: 0,
            characterEnd: 14,
          },
          tokenEstimate: 5,
          embedding: [],
          embeddingModel: "model-a",
        },
      ]),
    ).rejects.toThrow();

    expect(await sources.find(notebook.id, source.id)).toMatchObject({
      status: "indexing",
      passageCount: 1,
    });
    const persisted = await sources.listPassages(notebook.id, source.id);
    expect(persisted.map((passage) => passage.content)).toEqual(["可靠的旧 Passage"]);
    expect(await sources.listAttempts(notebook.id, source.id)).toEqual([
      expect.objectContaining({ status: "completed" }),
      expect.objectContaining({ status: "running" }),
    ]);

    await sources.fail(notebook.id, source.id, {
      stage: "persist",
      code: "INVALID_VECTOR",
      message: "Embedding vector was rejected.",
      retryable: true,
    });
    expect(await sources.find(notebook.id, source.id)).toMatchObject({
      status: "failed",
      failure: { code: "INVALID_VECTOR" },
      passageCount: 1,
    });
    expect(await sources.listAttempts(notebook.id, source.id)).toEqual([
      expect.objectContaining({ status: "completed", finishedAt: expect.any(String) }),
      expect.objectContaining({ status: "failed", finishedAt: expect.any(String) }),
    ]);
  });

  it("completes an assistant Message and its Citations in one transaction", async () => {
    const firstNotebook = await notebooks.create("回答 Notebook");
    const secondNotebook = await notebooks.create("隔离 Notebook");
    const firstSource = await sources.create({
      notebookId: firstNotebook.id,
      title: "允许材料",
      kind: "text",
      mimeType: "text/plain",
    });
    const secondSource = await sources.create({
      notebookId: secondNotebook.id,
      title: "越界材料",
      kind: "text",
      mimeType: "text/plain",
    });
    const prepare = (content: string) => [
      {
        ordinal: 0,
        content,
        locator: {
          kind: "text" as const,
          startLine: 1,
          endLine: 1,
          characterStart: 0,
          characterEnd: content.length,
        },
        tokenEstimate: 4,
        embedding: [1, 0],
        embeddingModel: "model-a",
      },
    ];
    await sources.markStatus(firstNotebook.id, firstSource.id, "extracting");
    await sources.complete(firstNotebook.id, firstSource.id, prepare("允许证据"));
    await sources.markStatus(secondNotebook.id, secondSource.id, "extracting");
    await sources.complete(secondNotebook.id, secondSource.id, prepare("越界证据"));
    const [allowedPassage] = await sources.listPassages(firstNotebook.id, firstSource.id);
    const [foreignPassage] = await sources.listPassages(secondNotebook.id, secondSource.id);
    expect(allowedPassage).toBeDefined();
    expect(foreignPassage).toBeDefined();

    const conversation = await conversations.create(firstNotebook.id, "事务回答");
    const pending = await conversations.addMessage({
      notebookId: firstNotebook.id,
      conversationId: conversation.id,
      role: "assistant",
      status: "pending",
      content: "",
    });
    await expect(
      conversations.completeAssistantMessage({
        notebookId: firstNotebook.id,
        conversationId: conversation.id,
        messageId: pending.id,
        content: "不应完成的答案 [P1]",
        citations: [
          {
            passageId: foreignPassage?.id ?? "",
            sourceId: secondSource.id,
            sourceTitle: secondSource.title,
            label: "P1",
            locator: foreignPassage?.locator ?? {
              kind: "text",
              startLine: 1,
              endLine: 1,
              characterStart: 0,
              characterEnd: 4,
            },
            excerpt: "越界证据",
          },
        ],
      }),
    ).rejects.toThrow();
    expect(await conversations.findMessage(firstNotebook.id, pending.id)).toMatchObject({
      status: "pending",
      content: "",
      citations: [],
    });

    const completed = await conversations.completeAssistantMessage({
      notebookId: firstNotebook.id,
      conversationId: conversation.id,
      messageId: pending.id,
      content: "可验证答案 [P1]",
      citations: [
        {
          passageId: allowedPassage?.id ?? "",
          sourceId: firstSource.id,
          sourceTitle: firstSource.title,
          label: "P1",
          locator: allowedPassage?.locator ?? {
            kind: "text",
            startLine: 1,
            endLine: 1,
            characterStart: 0,
            characterEnd: 4,
          },
          excerpt: "允许证据",
        },
      ],
    });
    expect(completed).toMatchObject({
      status: "completed",
      content: "可验证答案 [P1]",
      citations: [expect.objectContaining({ label: "P1", excerpt: "允许证据" })],
    });
  });

  it("rejects Source mutations through a different Notebook", async () => {
    const owner = await notebooks.create("Source 所属 Notebook");
    const foreign = await notebooks.create("错误 Notebook");
    const source = await sources.create({
      notebookId: owner.id,
      title: "隔离材料",
      kind: "text",
      mimeType: "text/plain",
    });
    await sources.markStatus(owner.id, source.id, "extracting");
    await sources.complete(owner.id, source.id, [
      {
        ordinal: 0,
        content: "不能被其他 Notebook 删除的证据",
        locator: {
          kind: "text",
          startLine: 1,
          endLine: 1,
          characterStart: 0,
          characterEnd: 20,
        },
        tokenEstimate: 8,
        embedding: [1, 0],
        embeddingModel: "model-a",
      },
    ]);

    await expect(sources.complete(foreign.id, source.id, [])).rejects.toThrow();
    await expect(sources.markStatus(foreign.id, source.id, "indexing")).rejects.toThrow();
    await expect(
      sources.fail(foreign.id, source.id, {
        stage: "persist",
        code: "SHOULD_NOT_APPLY",
        message: "wrong Notebook",
        retryable: false,
      }),
    ).rejects.toThrow();
    expect(await sources.listPassages(owner.id, source.id)).toEqual([
      expect.objectContaining({ content: "不能被其他 Notebook 删除的证据" }),
    ]);
    expect(await sources.find(owner.id, source.id)).toMatchObject({ status: "ready" });
    expect(await sources.find(foreign.id, source.id)).toBeUndefined();
    expect(await sources.listPassages(foreign.id, source.id)).toEqual([]);
  });

  it("keeps retrieval, Conversations, Messages, and Notes inside one Notebook", async () => {
    const firstNotebook = await notebooks.create("第一隔离区");
    const secondNotebook = await notebooks.create("第二隔离区");
    const firstSource = await sources.create({
      notebookId: firstNotebook.id,
      title: "第一证据",
      kind: "text",
      mimeType: "text/plain",
    });
    const secondSource = await sources.create({
      notebookId: secondNotebook.id,
      title: "第二证据",
      kind: "text",
      mimeType: "text/plain",
    });
    const passage = (content: string, embedding: readonly number[]) => [
      {
        ordinal: 0,
        content,
        locator: {
          kind: "text" as const,
          startLine: 1,
          endLine: 1,
          characterStart: 0,
          characterEnd: content.length,
        },
        tokenEstimate: 3,
        embedding,
        embeddingModel: "isolation-model",
      },
    ];
    await sources.markStatus(firstNotebook.id, firstSource.id, "extracting");
    await sources.complete(firstNotebook.id, firstSource.id, passage("第一内容", [0.8, 0.2]));
    await sources.markStatus(secondNotebook.id, secondSource.id, "extracting");
    await sources.complete(secondNotebook.id, secondSource.id, passage("第二内容", [1, 0]));

    const retrieved = await sources.searchPassages({
      notebookId: firstNotebook.id,
      embedding: [1, 0],
      embeddingModel: "isolation-model",
      limit: 10,
    });
    expect(retrieved.map((candidate) => candidate.sourceId)).toEqual([firstSource.id]);

    const conversation = await conversations.create(firstNotebook.id, "隔离对话");
    await expect(
      conversations.addMessage({
        notebookId: secondNotebook.id,
        conversationId: conversation.id,
        role: "researcher",
        status: "completed",
        content: "越界问题",
      }),
    ).rejects.toThrow();
    expect(await conversations.find(secondNotebook.id, conversation.id)).toBeUndefined();

    const message = await conversations.addMessage({
      notebookId: firstNotebook.id,
      conversationId: conversation.id,
      role: "assistant",
      status: "completed",
      content: "已完成回答",
    });
    const note = await notes.create({
      notebookId: firstNotebook.id,
      title: "第一 Note",
      content: "正文",
      sourceMessageId: message.id,
    });
    expect(await notes.find(secondNotebook.id, note.id)).toBeUndefined();
    expect(await notes.update(secondNotebook.id, note.id, { title: "越界修改" })).toBeUndefined();
    expect(await notes.delete(secondNotebook.id, note.id)).toBe(false);
    await expect(
      notes.create({
        notebookId: secondNotebook.id,
        title: "非法来源",
        content: "正文",
        sourceMessageId: message.id,
      }),
    ).rejects.toThrow();
    expect(await notes.find(firstNotebook.id, note.id)).toMatchObject({ title: "第一 Note" });
  });
});
