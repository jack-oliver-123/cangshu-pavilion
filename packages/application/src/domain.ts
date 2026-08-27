export type NotebookId = string;
export type SourceId = string;
export type PassageId = string;
export type ConversationId = string;
export type MessageId = string;
export type CitationId = string;
export type NoteId = string;

export interface Notebook {
  readonly id: NotebookId;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type SourceKind = "pdf" | "web" | "text" | "markdown";
export type SourceStatus = "queued" | "extracting" | "indexing" | "ready" | "failed";

export interface SourceFailure {
  readonly stage: "import" | "extract" | "embed" | "persist";
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface Source {
  readonly id: SourceId;
  readonly notebookId: NotebookId;
  readonly title: string;
  readonly kind: SourceKind;
  readonly status: SourceStatus;
  readonly mimeType: string;
  readonly originalUrl?: string;
  readonly storageKey?: string;
  readonly contentHash?: string;
  readonly sizeBytes?: number;
  readonly passageCount: number;
  readonly failure?: SourceFailure;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SourceProcessingAttempt {
  readonly id: string;
  readonly notebookId: NotebookId;
  readonly sourceId: SourceId;
  readonly status: "running" | "completed" | "failed";
  readonly failure?: SourceFailure;
  readonly startedAt: string;
  readonly finishedAt?: string;
}

export type SourceLocator =
  | Readonly<{
      kind: "pdf";
      page: number;
      characterStart: number;
      characterEnd: number;
    }>
  | Readonly<{
      kind: "web";
      url: string;
      paragraph: number;
      characterStart: number;
      characterEnd: number;
    }>
  | Readonly<{
      kind: "text";
      startLine: number;
      endLine: number;
      characterStart: number;
      characterEnd: number;
    }>;

export interface Passage {
  readonly id: PassageId;
  readonly notebookId: NotebookId;
  readonly sourceId: SourceId;
  readonly sourceTitle: string;
  readonly ordinal: number;
  readonly content: string;
  readonly locator: SourceLocator;
}

export interface PassageCandidate extends Passage {
  readonly similarity: number;
}

export type ExtractedLocator =
  | Readonly<{ kind: "pdf"; page: number }>
  | Readonly<{ kind: "web"; url: string; paragraph: number }>
  | Readonly<{ kind: "text"; startLine: number; endLine: number }>;

export interface ExtractedBlock {
  readonly content: string;
  readonly locator: ExtractedLocator;
}

export interface PreparedPassage {
  readonly ordinal: number;
  readonly content: string;
  readonly locator: SourceLocator;
  readonly tokenEstimate: number;
  readonly embedding: readonly number[];
  readonly embeddingModel: string;
}

export interface Conversation {
  readonly id: ConversationId;
  readonly notebookId: NotebookId;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type MessageRole = "researcher" | "assistant";
export type MessageStatus = "pending" | "completed" | "failed";

export interface Citation {
  readonly id: CitationId;
  readonly messageId: MessageId;
  readonly passageId: PassageId;
  readonly sourceId: SourceId;
  readonly sourceTitle: string;
  readonly label: string;
  readonly locator: SourceLocator;
  readonly excerpt: string;
}

export interface Message {
  readonly id: MessageId;
  readonly conversationId: ConversationId;
  readonly role: MessageRole;
  readonly status: MessageStatus;
  readonly content: string;
  readonly citations: readonly Citation[];
  readonly createdAt: string;
}

export interface ConversationDetail extends Conversation {
  readonly messages: readonly Message[];
}

export interface Note {
  readonly id: NoteId;
  readonly notebookId: NotebookId;
  readonly title: string;
  readonly content: string;
  readonly sourceMessageId?: MessageId;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ProviderKind = "chat" | "embedding";

export interface PublicProviderConfiguration {
  readonly kind: ProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  readonly hasApiKey: boolean;
  readonly source: "database" | "environment" | "missing";
}

export interface ProviderConfigurationInput {
  readonly kind: ProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
}

export type AnswerEvent =
  | Readonly<{ type: "answer.started"; messageId: MessageId }>
  | Readonly<{ type: "answer.delta"; delta: string }>
  | Readonly<{ type: "citation"; citation: Citation }>
  | Readonly<{ type: "answer.completed"; message: Message }>
  | Readonly<{ type: "answer.failed"; code: string; message: string }>;
