import type { SourceFailure, SourceLocator } from "@cangshu/application";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const vector = customType<{ data: readonly number[]; driverData: string }>({
  dataType() {
    return "vector";
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    const normalized = value.trim().replace(/^\[/, "").replace(/\]$/, "");
    return normalized.length === 0 ? [] : normalized.split(",").map(Number);
  },
});

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
};

export const notebooks = pgTable("notebooks", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  ...timestamps,
});

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    notebookId: uuid("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: text("kind").notNull(),
    status: text("status").default("queued").notNull(),
    mimeType: text("mime_type").notNull(),
    originalUrl: text("original_url"),
    storageKey: text("storage_key"),
    contentHash: text("content_hash"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    passageCount: integer("passage_count").default(0).notNull(),
    failure: jsonb("failure").$type<SourceFailure>(),
    ...timestamps,
  },
  (table) => [
    unique("sources_id_notebook_unique").on(table.id, table.notebookId),
    uniqueIndex("sources_notebook_hash_unique")
      .on(table.notebookId, table.contentHash)
      .where(sql`${table.contentHash} is not null`),
    index("sources_notebook_created_idx").on(table.notebookId, table.createdAt),
    check("sources_kind_check", sql`${table.kind} in ('pdf', 'web', 'text', 'markdown')`),
    check(
      "sources_status_check",
      sql`${table.status} in ('queued', 'extracting', 'indexing', 'ready', 'failed')`,
    ),
  ],
);

export const sourceProcessingAttempts = pgTable(
  "source_processing_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    notebookId: uuid("notebook_id").notNull(),
    sourceId: uuid("source_id").notNull(),
    status: text("status").default("running").notNull(),
    failure: jsonb("failure").$type<SourceFailure>(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    foreignKey({
      columns: [table.sourceId, table.notebookId],
      foreignColumns: [sources.id, sources.notebookId],
      name: "source_attempts_source_notebook_fk",
    }).onDelete("cascade"),
    index("source_attempts_source_started_idx").on(table.sourceId, table.startedAt),
    check(
      "source_attempts_status_check",
      sql`${table.status} in ('running', 'completed', 'failed')`,
    ),
  ],
);

export const passages = pgTable(
  "passages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    notebookId: uuid("notebook_id").notNull(),
    sourceId: uuid("source_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    content: text("content").notNull(),
    locator: jsonb("locator").$type<SourceLocator>().notNull(),
    tokenEstimate: integer("token_estimate").notNull(),
    embedding: vector("embedding").notNull(),
    embeddingModel: text("embedding_model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.sourceId, table.notebookId],
      foreignColumns: [sources.id, sources.notebookId],
      name: "passages_source_notebook_fk",
    }).onDelete("cascade"),
    unique("passages_id_notebook_source_unique").on(table.id, table.notebookId, table.sourceId),
    unique("passages_source_ordinal_unique").on(table.sourceId, table.ordinal),
    index("passages_notebook_model_idx").on(table.notebookId, table.embeddingModel),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    notebookId: uuid("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("conversations_id_notebook_unique").on(table.id, table.notebookId),
    index("conversations_notebook_updated_idx").on(table.notebookId, table.updatedAt),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    notebookId: uuid("notebook_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.conversationId, table.notebookId],
      foreignColumns: [conversations.id, conversations.notebookId],
      name: "messages_conversation_notebook_fk",
    }).onDelete("cascade"),
    unique("messages_id_notebook_unique").on(table.id, table.notebookId),
    index("messages_conversation_created_idx").on(table.conversationId, table.createdAt),
    check("messages_role_check", sql`${table.role} in ('researcher', 'assistant')`),
    check("messages_status_check", sql`${table.status} in ('pending', 'completed', 'failed')`),
  ],
);

export const citations = pgTable(
  "citations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    notebookId: uuid("notebook_id").notNull(),
    messageId: uuid("message_id").notNull(),
    passageId: uuid("passage_id").notNull(),
    sourceId: uuid("source_id").notNull(),
    sourceTitle: text("source_title").notNull(),
    label: text("label").notNull(),
    locator: jsonb("locator").$type<SourceLocator>().notNull(),
    excerpt: text("excerpt").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.messageId, table.notebookId],
      foreignColumns: [messages.id, messages.notebookId],
      name: "citations_message_notebook_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.passageId, table.notebookId, table.sourceId],
      foreignColumns: [passages.id, passages.notebookId, passages.sourceId],
      name: "citations_passage_notebook_source_fk",
    }).onDelete("restrict"),
    unique("citations_message_label_unique").on(table.messageId, table.label),
  ],
);

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    notebookId: uuid("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    sourceMessageId: uuid("source_message_id"),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.sourceMessageId, table.notebookId],
      foreignColumns: [messages.id, messages.notebookId],
      name: "notes_source_message_notebook_fk",
    }).onDelete("cascade"),
    index("notes_notebook_updated_idx").on(table.notebookId, table.updatedAt),
  ],
);

export const providerConfigurations = pgTable(
  "provider_configurations",
  {
    kind: text("kind").notNull(),
    baseUrl: text("base_url").notNull(),
    model: text("model").notNull(),
    encryptedApiKey: text("encrypted_api_key").notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.kind] }),
    check("provider_kind_check", sql`${table.kind} in ('chat', 'embedding')`),
  ],
);

export type DatabaseSchema = {
  notebooks: typeof notebooks;
  sources: typeof sources;
  sourceProcessingAttempts: typeof sourceProcessingAttempts;
  passages: typeof passages;
  conversations: typeof conversations;
  messages: typeof messages;
  citations: typeof citations;
  notes: typeof notes;
  providerConfigurations: typeof providerConfigurations;
};
