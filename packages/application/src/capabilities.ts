import { defineCapability } from "@cangshu/plugin-kernel";
import type {
  AnswerEvent,
  Conversation,
  ConversationDetail,
  ConversationId,
  MessageId,
  Note,
  Notebook,
  NotebookId,
  NoteId,
  ProviderConfigurationInput,
  PublicProviderConfiguration,
  Source,
  SourceId,
  SourceKind,
} from "./domain.js";

export interface NotebookManagement {
  list(): Promise<readonly Notebook[]>;
  get(notebookId: NotebookId): Promise<Notebook>;
  create(name: string): Promise<Notebook>;
  rename(notebookId: NotebookId, name: string): Promise<Notebook>;
  delete(notebookId: NotebookId): Promise<void>;
}

export interface SourceIngestion {
  list(notebookId: NotebookId): Promise<readonly Source[]>;
  get(notebookId: NotebookId, sourceId: SourceId): Promise<Source>;
  importBytes(input: {
    notebookId: NotebookId;
    title: string;
    kind: Extract<SourceKind, "pdf" | "text" | "markdown">;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<Source>;
  importUrl(input: { notebookId: NotebookId; title?: string; url: string }): Promise<Source>;
  importText(input: {
    notebookId: NotebookId;
    title: string;
    text: string;
    kind?: Extract<SourceKind, "text" | "markdown">;
  }): Promise<Source>;
  retry(notebookId: NotebookId, sourceId: SourceId): Promise<Source>;
  reconcileStale(input: { before: string; limit: number }): Promise<number>;
  reindexReady(): Promise<number>;
  delete(notebookId: NotebookId, sourceId: SourceId): Promise<void>;
  process(notebookId: NotebookId, sourceId: SourceId): Promise<void>;
}

export interface ResearchAnswering {
  listConversations(notebookId: NotebookId): Promise<readonly Conversation[]>;
  getConversation(
    notebookId: NotebookId,
    conversationId: ConversationId,
  ): Promise<ConversationDetail>;
  createConversation(notebookId: NotebookId, title?: string): Promise<Conversation>;
  answer(input: {
    notebookId: NotebookId;
    conversationId: ConversationId;
    question: string;
  }): AsyncGenerator<AnswerEvent>;
}

export interface NoteManagement {
  list(notebookId: NotebookId): Promise<readonly Note[]>;
  get(notebookId: NotebookId, noteId: NoteId): Promise<Note>;
  create(input: { notebookId: NotebookId; title: string; content: string }): Promise<Note>;
  saveAnswer(input: {
    notebookId: NotebookId;
    messageId: MessageId;
    title?: string;
  }): Promise<Note>;
  update(
    notebookId: NotebookId,
    noteId: NoteId,
    changes: Readonly<{ title?: string; content?: string }>,
  ): Promise<Note>;
  delete(notebookId: NotebookId, noteId: NoteId): Promise<void>;
}

export interface ProviderSettingsManagement {
  list(): Promise<readonly PublicProviderConfiguration[]>;
  save(input: ProviderConfigurationInput): Promise<PublicProviderConfiguration>;
  test(input: ProviderConfigurationInput): Promise<void>;
}

export const NOTEBOOK_MANAGEMENT = defineCapability<NotebookManagement>(
  "cangshu.notebook-management",
);
export const SOURCE_INGESTION = defineCapability<SourceIngestion>("cangshu.source-ingestion");
export const RESEARCH_ANSWERING = defineCapability<ResearchAnswering>("cangshu.research-answering");
export const NOTE_MANAGEMENT = defineCapability<NoteManagement>("cangshu.note-management");
export const PROVIDER_SETTINGS = defineCapability<ProviderSettingsManagement>(
  "cangshu.provider-settings",
);
