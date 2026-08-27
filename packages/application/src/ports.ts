import type {
  Citation,
  Conversation,
  ConversationDetail,
  ConversationId,
  ExtractedBlock,
  Message,
  MessageId,
  Note,
  Notebook,
  NotebookId,
  NoteId,
  Passage,
  PassageCandidate,
  PreparedPassage,
  ProviderConfigurationInput,
  ProviderKind,
  PublicProviderConfiguration,
  Source,
  SourceFailure,
  SourceId,
  SourceKind,
  SourceProcessingAttempt,
} from "./domain.js";

export interface NotebookRepository {
  list(): Promise<readonly Notebook[]>;
  find(id: NotebookId): Promise<Notebook | undefined>;
  create(name: string): Promise<Notebook>;
  rename(id: NotebookId, name: string): Promise<Notebook | undefined>;
  listStorageKeys(id: NotebookId): Promise<readonly string[]>;
  delete(id: NotebookId): Promise<readonly string[]>;
}

export interface NewSourceRecord {
  readonly notebookId: NotebookId;
  readonly title: string;
  readonly kind: SourceKind;
  readonly mimeType: string;
  readonly originalUrl?: string;
  readonly storageKey?: string;
  readonly contentHash?: string;
  readonly sizeBytes?: number;
}

export interface SourceRepository {
  list(notebookId: NotebookId): Promise<readonly Source[]>;
  find(notebookId: NotebookId, sourceId: SourceId): Promise<Source | undefined>;
  listAttempts(
    notebookId: NotebookId,
    sourceId: SourceId,
  ): Promise<readonly SourceProcessingAttempt[]>;
  listPassages(notebookId: NotebookId, sourceId: SourceId): Promise<readonly Passage[]>;
  findByContentHash(notebookId: NotebookId, contentHash: string): Promise<Source | undefined>;
  listReady(): Promise<readonly Source[]>;
  listStale(input: { before: string; limit: number }): Promise<readonly Source[]>;
  requeueStale(input: {
    notebookId: NotebookId;
    sourceId: SourceId;
    before: string;
  }): Promise<boolean>;
  create(input: NewSourceRecord): Promise<Source>;
  markQueued(notebookId: NotebookId, sourceId: SourceId): Promise<Source | undefined>;
  markStatus(
    notebookId: NotebookId,
    sourceId: SourceId,
    status: "extracting" | "indexing",
  ): Promise<void>;
  complete(
    notebookId: NotebookId,
    sourceId: SourceId,
    passages: readonly PreparedPassage[],
  ): Promise<void>;
  fail(notebookId: NotebookId, sourceId: SourceId, failure: SourceFailure): Promise<void>;
  delete(
    notebookId: NotebookId,
    sourceId: SourceId,
  ): Promise<Readonly<{ deleted: boolean; unreferencedStorageKey?: string }>>;
  searchPassages(input: {
    notebookId: NotebookId;
    embedding: readonly number[];
    embeddingModel: string;
    limit: number;
  }): Promise<readonly PassageCandidate[]>;
}

export interface ConversationRepository {
  list(notebookId: NotebookId): Promise<readonly Conversation[]>;
  find(
    notebookId: NotebookId,
    conversationId: ConversationId,
  ): Promise<ConversationDetail | undefined>;
  findMessage(notebookId: NotebookId, messageId: MessageId): Promise<Message | undefined>;
  create(notebookId: NotebookId, title: string): Promise<Conversation>;
  addMessage(input: {
    notebookId: NotebookId;
    conversationId: ConversationId;
    role: "researcher" | "assistant";
    status: "pending" | "completed";
    content: string;
  }): Promise<Message>;
  completeAssistantMessage(input: {
    notebookId: NotebookId;
    conversationId: ConversationId;
    messageId: MessageId;
    content: string;
    citations: readonly Omit<Citation, "id" | "messageId">[];
  }): Promise<Message>;
  failAssistantMessage(input: {
    notebookId: NotebookId;
    conversationId: ConversationId;
    messageId: MessageId;
    content: string;
  }): Promise<void>;
}

export interface NoteRepository {
  list(notebookId: NotebookId): Promise<readonly Note[]>;
  find(notebookId: NotebookId, noteId: NoteId): Promise<Note | undefined>;
  create(input: {
    notebookId: NotebookId;
    title: string;
    content: string;
    sourceMessageId?: MessageId;
  }): Promise<Note>;
  update(
    notebookId: NotebookId,
    noteId: NoteId,
    changes: Readonly<{ title?: string; content?: string }>,
  ): Promise<Note | undefined>;
  delete(notebookId: NotebookId, noteId: NoteId): Promise<boolean>;
}

export interface StoredBlob {
  readonly storageKey: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
}

export interface SourceBlobStore {
  put(bytes: Uint8Array): Promise<StoredBlob>;
  read(storageKey: string): Promise<Uint8Array>;
  deleteIfExists(storageKey: string): Promise<void>;
}

export interface SourceBlobReferenceCoordinator {
  withLocks<T>(lockIds: readonly string[], operation: () => Promise<T>): Promise<T>;
}

export interface SourceJobQueue {
  enqueue(input: { notebookId: NotebookId; sourceId: SourceId }): Promise<void>;
}

export interface SourceExtractor {
  extract(source: Source): Promise<readonly ExtractedBlock[]>;
}

export interface EmbeddingModel {
  readonly modelKey: string;
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

export interface ChatPassage {
  readonly label: string;
  readonly passageId: string;
  readonly sourceTitle: string;
  readonly locator: string;
  readonly content: string;
}

export type ChatModelEvent =
  | Readonly<{ type: "delta"; delta: string }>
  | Readonly<{ type: "completed"; content: string; citedLabels: readonly string[] }>;

export interface ChatModel {
  stream(input: {
    question: string;
    history: readonly Readonly<{ role: "researcher" | "assistant"; content: string }>[];
    passages: readonly ChatPassage[];
  }): AsyncGenerator<ChatModelEvent>;
}

export interface ModelProviderResolver {
  embedding(): Promise<EmbeddingModel>;
  chat(): Promise<ChatModel>;
}

export interface ProviderConfigurationVault {
  list(): Promise<readonly PublicProviderConfiguration[]>;
  save(input: ProviderConfigurationInput): Promise<PublicProviderConfiguration>;
  test(input: ProviderConfigurationInput): Promise<void>;
  resolve(
    kind: ProviderKind,
  ): Promise<Readonly<{ baseUrl: string; model: string; apiKey: string }>>;
}
