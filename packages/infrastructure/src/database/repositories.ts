import type {
  Citation,
  Conversation,
  ConversationDetail,
  ConversationRepository,
  Message,
  Note,
  Notebook,
  NotebookRepository,
  NoteRepository,
  Passage,
  PassageCandidate,
  Source,
  SourceProcessingAttempt,
  SourceRepository,
} from "@cangshu/application";
import { and, asc, count, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { CangshuDatabase } from "./client.js";
import {
  citations,
  conversations,
  messages,
  notebooks,
  notes,
  passages,
  sourceProcessingAttempts,
  sources,
} from "./schema.js";

export class PostgresNotebookRepository implements NotebookRepository {
  constructor(private readonly db: CangshuDatabase) {}

  async list(): Promise<readonly Notebook[]> {
    return this.db.select().from(notebooks).orderBy(desc(notebooks.updatedAt));
  }

  async find(id: string): Promise<Notebook | undefined> {
    const [notebook] = await this.db.select().from(notebooks).where(eq(notebooks.id, id)).limit(1);
    return notebook;
  }

  async create(name: string): Promise<Notebook> {
    const [notebook] = await this.db.insert(notebooks).values({ name }).returning();
    if (!notebook) {
      throw new Error("Notebook insert did not return a record.");
    }
    return notebook;
  }

  async rename(id: string, name: string): Promise<Notebook | undefined> {
    const [notebook] = await this.db
      .update(notebooks)
      .set({ name, updatedAt: now() })
      .where(eq(notebooks.id, id))
      .returning();
    return notebook;
  }

  async listStorageKeys(id: string): Promise<readonly string[]> {
    const stored = await this.db
      .select({ storageKey: sources.storageKey })
      .from(sources)
      .where(eq(sources.notebookId, id));
    return [...new Set(stored.flatMap(({ storageKey }) => (storageKey ? [storageKey] : [])))];
  }

  async delete(id: string): Promise<readonly string[]> {
    return this.db.transaction(async (transaction) => {
      const stored = await transaction
        .select({ storageKey: sources.storageKey })
        .from(sources)
        .where(eq(sources.notebookId, id));
      await transaction.delete(notebooks).where(eq(notebooks.id, id));
      const uniqueKeys = [
        ...new Set(stored.flatMap(({ storageKey }) => (storageKey ? [storageKey] : []))),
      ];
      const unreferenced: string[] = [];
      for (const storageKey of uniqueKeys) {
        const [remaining] = await transaction
          .select({ value: count() })
          .from(sources)
          .where(eq(sources.storageKey, storageKey));
        if ((remaining?.value ?? 0) === 0) {
          unreferenced.push(storageKey);
        }
      }
      return unreferenced;
    });
  }
}

export class PostgresSourceRepository implements SourceRepository {
  constructor(private readonly db: CangshuDatabase) {}

  async list(notebookId: string): Promise<readonly Source[]> {
    const rows = await this.db
      .select()
      .from(sources)
      .where(eq(sources.notebookId, notebookId))
      .orderBy(desc(sources.createdAt));
    return rows.map(mapSource);
  }

  async find(notebookId: string, sourceId: string): Promise<Source | undefined> {
    const [row] = await this.db
      .select()
      .from(sources)
      .where(and(eq(sources.notebookId, notebookId), eq(sources.id, sourceId)))
      .limit(1);
    return row ? mapSource(row) : undefined;
  }

  async listAttempts(
    notebookId: string,
    sourceId: string,
  ): Promise<readonly SourceProcessingAttempt[]> {
    const rows = await this.db
      .select()
      .from(sourceProcessingAttempts)
      .where(
        and(
          eq(sourceProcessingAttempts.notebookId, notebookId),
          eq(sourceProcessingAttempts.sourceId, sourceId),
        ),
      )
      .orderBy(asc(sourceProcessingAttempts.startedAt));
    return rows.map((row) => ({
      id: row.id,
      notebookId: row.notebookId,
      sourceId: row.sourceId,
      status: row.status as SourceProcessingAttempt["status"],
      startedAt: row.startedAt,
      ...(row.finishedAt ? { finishedAt: row.finishedAt } : {}),
      ...(row.failure ? { failure: row.failure } : {}),
    }));
  }

  async listPassages(notebookId: string, sourceId: string): Promise<readonly Passage[]> {
    return this.db
      .select({
        id: passages.id,
        notebookId: passages.notebookId,
        sourceId: passages.sourceId,
        sourceTitle: sources.title,
        ordinal: passages.ordinal,
        content: passages.content,
        locator: passages.locator,
      })
      .from(passages)
      .innerJoin(sources, eq(sources.id, passages.sourceId))
      .where(and(eq(passages.notebookId, notebookId), eq(passages.sourceId, sourceId)))
      .orderBy(asc(passages.ordinal));
  }

  async findByContentHash(notebookId: string, contentHash: string): Promise<Source | undefined> {
    const [row] = await this.db
      .select()
      .from(sources)
      .where(and(eq(sources.notebookId, notebookId), eq(sources.contentHash, contentHash)))
      .limit(1);
    return row ? mapSource(row) : undefined;
  }

  async listReady(): Promise<readonly Source[]> {
    const rows = await this.db
      .select()
      .from(sources)
      .where(eq(sources.status, "ready"))
      .orderBy(asc(sources.createdAt));
    return rows.map(mapSource);
  }

  async listStale(input: { before: string; limit: number }): Promise<readonly Source[]> {
    const rows = await this.db
      .select()
      .from(sources)
      .where(
        and(
          inArray(sources.status, ["queued", "extracting", "indexing"]),
          lt(sources.updatedAt, input.before),
        ),
      )
      .orderBy(asc(sources.updatedAt))
      .limit(input.limit);
    return rows.map(mapSource);
  }

  async requeueStale(input: {
    notebookId: string;
    sourceId: string;
    before: string;
  }): Promise<boolean> {
    return this.db.transaction(async (transaction) => {
      const interruption: Source["failure"] = {
        stage: "persist",
        code: "PROCESS_INTERRUPTED",
        message: "Source processing was interrupted and requeued.",
        retryable: true,
      };
      const [claimed] = await transaction
        .update(sources)
        .set({ status: "queued", failure: null, updatedAt: now() })
        .where(
          and(
            eq(sources.notebookId, input.notebookId),
            eq(sources.id, input.sourceId),
            inArray(sources.status, ["queued", "extracting", "indexing"]),
            lt(sources.updatedAt, input.before),
          ),
        )
        .returning({ id: sources.id });
      if (!claimed) {
        return false;
      }
      await transaction
        .update(sourceProcessingAttempts)
        .set({ status: "failed", failure: interruption, finishedAt: now() })
        .where(
          and(
            eq(sourceProcessingAttempts.notebookId, input.notebookId),
            eq(sourceProcessingAttempts.sourceId, input.sourceId),
            eq(sourceProcessingAttempts.status, "running"),
          ),
        );
      return true;
    });
  }

  async create(input: Parameters<SourceRepository["create"]>[0]): Promise<Source> {
    const [row] = await this.db.insert(sources).values(input).returning();
    if (!row) {
      throw new Error("Source insert did not return a record.");
    }
    return mapSource(row);
  }

  async markQueued(notebookId: string, sourceId: string): Promise<Source | undefined> {
    const [row] = await this.db
      .update(sources)
      .set({ status: "queued", failure: null, updatedAt: now() })
      .where(and(eq(sources.notebookId, notebookId), eq(sources.id, sourceId)))
      .returning();
    return row ? mapSource(row) : undefined;
  }

  async markStatus(
    notebookId: string,
    sourceId: string,
    status: "extracting" | "indexing",
  ): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const [owned] = await transaction
        .update(sources)
        .set({ status, failure: null, updatedAt: now() })
        .where(and(eq(sources.notebookId, notebookId), eq(sources.id, sourceId)))
        .returning({ id: sources.id });
      assertOwnedSource(owned, notebookId, sourceId);
      if (status === "extracting") {
        await transaction.insert(sourceProcessingAttempts).values({ notebookId, sourceId });
      }
    });
  }

  async complete(
    notebookId: string,
    sourceId: string,
    prepared: Parameters<SourceRepository["complete"]>[2],
  ): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const [owned] = await transaction
        .select({ id: sources.id })
        .from(sources)
        .where(and(eq(sources.notebookId, notebookId), eq(sources.id, sourceId)))
        .for("update");
      assertOwnedSource(owned, notebookId, sourceId);
      await transaction
        .delete(passages)
        .where(and(eq(passages.notebookId, notebookId), eq(passages.sourceId, sourceId)));
      if (prepared.length > 0) {
        await transaction.insert(passages).values(
          prepared.map((passage) => ({
            notebookId,
            sourceId,
            ordinal: passage.ordinal,
            content: passage.content,
            locator: passage.locator,
            tokenEstimate: passage.tokenEstimate,
            embedding: passage.embedding,
            embeddingModel: passage.embeddingModel,
          })),
        );
      }
      await transaction
        .update(sources)
        .set({
          status: "ready",
          failure: null,
          passageCount: prepared.length,
          updatedAt: now(),
        })
        .where(and(eq(sources.notebookId, notebookId), eq(sources.id, sourceId)));
      await transaction
        .update(sourceProcessingAttempts)
        .set({ status: "completed", finishedAt: now() })
        .where(
          and(
            eq(sourceProcessingAttempts.notebookId, notebookId),
            eq(sourceProcessingAttempts.sourceId, sourceId),
            eq(sourceProcessingAttempts.status, "running"),
          ),
        );
    });
  }

  async fail(
    notebookId: string,
    sourceId: string,
    failure: Parameters<SourceRepository["fail"]>[2],
  ): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const [owned] = await transaction
        .update(sources)
        .set({ status: "failed", failure, updatedAt: now() })
        .where(and(eq(sources.notebookId, notebookId), eq(sources.id, sourceId)))
        .returning({ id: sources.id });
      assertOwnedSource(owned, notebookId, sourceId);
      await transaction
        .update(sourceProcessingAttempts)
        .set({ status: "failed", failure, finishedAt: now() })
        .where(
          and(
            eq(sourceProcessingAttempts.notebookId, notebookId),
            eq(sourceProcessingAttempts.sourceId, sourceId),
            eq(sourceProcessingAttempts.status, "running"),
          ),
        );
    });
  }

  async delete(notebookId: string, sourceId: string) {
    return this.db.transaction(async (transaction) => {
      const [row] = await transaction
        .delete(sources)
        .where(and(eq(sources.notebookId, notebookId), eq(sources.id, sourceId)))
        .returning({ storageKey: sources.storageKey });
      if (!row) {
        return { deleted: false } as const;
      }
      if (!row.storageKey) {
        return { deleted: true } as const;
      }
      const [remaining] = await transaction
        .select({ value: count() })
        .from(sources)
        .where(eq(sources.storageKey, row.storageKey));
      return (remaining?.value ?? 0) === 0
        ? ({ deleted: true, unreferencedStorageKey: row.storageKey } as const)
        : ({ deleted: true } as const);
    });
  }

  async searchPassages(input: Parameters<SourceRepository["searchPassages"]>[0]) {
    if (input.embedding.some((value) => !Number.isFinite(value))) {
      throw new Error("Query embedding contains a non-finite value.");
    }
    const queryVector = `[${input.embedding.join(",")}]`;
    const distance = sql<number>`${passages.embedding} <=> ${queryVector}::vector`;
    const rows = await this.db
      .select({
        id: passages.id,
        notebookId: passages.notebookId,
        sourceId: passages.sourceId,
        sourceTitle: sources.title,
        ordinal: passages.ordinal,
        content: passages.content,
        locator: passages.locator,
        similarity: sql<number>`1 - (${distance})`,
      })
      .from(passages)
      .innerJoin(sources, eq(sources.id, passages.sourceId))
      .where(
        and(
          eq(passages.notebookId, input.notebookId),
          eq(passages.embeddingModel, input.embeddingModel),
          eq(sources.status, "ready"),
        ),
      )
      .orderBy(distance)
      .limit(input.limit);
    return rows as readonly PassageCandidate[];
  }
}

export class PostgresConversationRepository implements ConversationRepository {
  constructor(private readonly db: CangshuDatabase) {}

  async list(notebookId: string): Promise<readonly Conversation[]> {
    return this.db
      .select()
      .from(conversations)
      .where(eq(conversations.notebookId, notebookId))
      .orderBy(desc(conversations.updatedAt));
  }

  async find(notebookId: string, conversationId: string): Promise<ConversationDetail | undefined> {
    const [conversation] = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.notebookId, notebookId), eq(conversations.id, conversationId)))
      .limit(1);
    if (!conversation) {
      return undefined;
    }
    const messageRows = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.notebookId, notebookId), eq(messages.conversationId, conversationId)))
      .orderBy(asc(messages.createdAt));
    const citationRows =
      messageRows.length === 0
        ? []
        : await this.db
            .select()
            .from(citations)
            .where(
              and(
                eq(citations.notebookId, notebookId),
                inArray(
                  citations.messageId,
                  messageRows.map((message) => message.id),
                ),
              ),
            )
            .orderBy(asc(citations.createdAt));
    const byMessage = new Map<string, Citation[]>();
    for (const citation of citationRows) {
      const list = byMessage.get(citation.messageId) ?? [];
      list.push(citation);
      byMessage.set(citation.messageId, list);
    }
    return {
      ...conversation,
      messages: messageRows.map((message) => mapMessage(message, byMessage.get(message.id) ?? [])),
    };
  }

  async findMessage(notebookId: string, messageId: string): Promise<Message | undefined> {
    const [message] = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.notebookId, notebookId), eq(messages.id, messageId)))
      .limit(1);
    if (!message) {
      return undefined;
    }
    const citationRows = await this.db
      .select()
      .from(citations)
      .where(and(eq(citations.notebookId, notebookId), eq(citations.messageId, messageId)))
      .orderBy(asc(citations.createdAt));
    return mapMessage(message, citationRows);
  }

  async create(notebookId: string, title: string): Promise<Conversation> {
    const [conversation] = await this.db
      .insert(conversations)
      .values({ notebookId, title })
      .returning();
    if (!conversation) {
      throw new Error("Conversation insert did not return a record.");
    }
    return conversation;
  }

  async addMessage(input: Parameters<ConversationRepository["addMessage"]>[0]): Promise<Message> {
    return this.db.transaction(async (transaction) => {
      const [message] = await transaction.insert(messages).values(input).returning();
      if (!message) {
        throw new Error("Message insert did not return a record.");
      }
      await transaction
        .update(conversations)
        .set({ updatedAt: now() })
        .where(
          and(
            eq(conversations.notebookId, input.notebookId),
            eq(conversations.id, input.conversationId),
          ),
        );
      return mapMessage(message, []);
    });
  }

  async completeAssistantMessage(
    input: Parameters<ConversationRepository["completeAssistantMessage"]>[0],
  ): Promise<Message> {
    return this.db.transaction(async (transaction) => {
      const [message] = await transaction
        .update(messages)
        .set({ status: "completed", content: input.content })
        .where(
          and(
            eq(messages.notebookId, input.notebookId),
            eq(messages.conversationId, input.conversationId),
            eq(messages.id, input.messageId),
            eq(messages.role, "assistant"),
          ),
        )
        .returning();
      if (!message) {
        throw new Error("Pending assistant message was not found.");
      }
      const inserted =
        input.citations.length === 0
          ? []
          : await transaction
              .insert(citations)
              .values(
                input.citations.map((citation) => ({
                  ...citation,
                  notebookId: input.notebookId,
                  messageId: input.messageId,
                })),
              )
              .returning();
      await transaction
        .update(conversations)
        .set({ updatedAt: now() })
        .where(eq(conversations.id, input.conversationId));
      return mapMessage(message, inserted);
    });
  }

  async failAssistantMessage(
    input: Parameters<ConversationRepository["failAssistantMessage"]>[0],
  ): Promise<void> {
    await this.db
      .update(messages)
      .set({ status: "failed", content: input.content })
      .where(
        and(
          eq(messages.notebookId, input.notebookId),
          eq(messages.conversationId, input.conversationId),
          eq(messages.id, input.messageId),
          eq(messages.role, "assistant"),
        ),
      );
  }
}

export class PostgresNoteRepository implements NoteRepository {
  constructor(private readonly db: CangshuDatabase) {}

  async list(notebookId: string): Promise<readonly Note[]> {
    const rows = await this.db
      .select()
      .from(notes)
      .where(eq(notes.notebookId, notebookId))
      .orderBy(desc(notes.updatedAt));
    return rows.map(mapNote);
  }

  async find(notebookId: string, noteId: string): Promise<Note | undefined> {
    const [row] = await this.db
      .select()
      .from(notes)
      .where(and(eq(notes.notebookId, notebookId), eq(notes.id, noteId)))
      .limit(1);
    return row ? mapNote(row) : undefined;
  }

  async create(input: Parameters<NoteRepository["create"]>[0]): Promise<Note> {
    const [row] = await this.db.insert(notes).values(input).returning();
    if (!row) {
      throw new Error("Note insert did not return a record.");
    }
    return mapNote(row);
  }

  async update(
    notebookId: string,
    noteId: string,
    changes: Parameters<NoteRepository["update"]>[2],
  ): Promise<Note | undefined> {
    const [row] = await this.db
      .update(notes)
      .set({ ...changes, updatedAt: now() })
      .where(and(eq(notes.notebookId, notebookId), eq(notes.id, noteId)))
      .returning();
    return row ? mapNote(row) : undefined;
  }

  async delete(notebookId: string, noteId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(notes)
      .where(and(eq(notes.notebookId, notebookId), eq(notes.id, noteId)))
      .returning({ id: notes.id });
    return deleted.length > 0;
  }
}

function now(): string {
  return new Date().toISOString();
}

function assertOwnedSource(
  source: Readonly<{ id: string }> | undefined,
  notebookId: string,
  sourceId: string,
): asserts source is Readonly<{ id: string }> {
  if (!source) {
    throw new Error(`Source "${sourceId}" was not found in Notebook "${notebookId}".`);
  }
}

function mapSource(row: typeof sources.$inferSelect): Source {
  return {
    id: row.id,
    notebookId: row.notebookId,
    title: row.title,
    kind: row.kind as Source["kind"],
    status: row.status as Source["status"],
    mimeType: row.mimeType,
    passageCount: row.passageCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.originalUrl ? { originalUrl: row.originalUrl } : {}),
    ...(row.storageKey ? { storageKey: row.storageKey } : {}),
    ...(row.contentHash ? { contentHash: row.contentHash } : {}),
    ...(row.sizeBytes === null ? {} : { sizeBytes: row.sizeBytes }),
    ...(row.failure ? { failure: row.failure } : {}),
  };
}

function mapMessage(
  row: typeof messages.$inferSelect,
  messageCitations: readonly Citation[],
): Message {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as Message["role"],
    status: row.status as Message["status"],
    content: row.content,
    citations: messageCitations,
    createdAt: row.createdAt,
  };
}

function mapNote(row: typeof notes.$inferSelect): Note {
  return {
    id: row.id,
    notebookId: row.notebookId,
    title: row.title,
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.sourceMessageId ? { sourceMessageId: row.sourceMessageId } : {}),
  };
}
