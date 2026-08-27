export interface Notebook {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SourceFailure {
  readonly stage: "import" | "extract" | "embed" | "persist";
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface Source {
  readonly id: string;
  readonly notebookId: string;
  readonly title: string;
  readonly kind: "pdf" | "web" | "text" | "markdown";
  readonly status: "queued" | "extracting" | "indexing" | "ready" | "failed";
  readonly mimeType: string;
  readonly originalUrl?: string;
  readonly passageCount: number;
  readonly failure?: SourceFailure;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type SourceLocator =
  | {
      readonly kind: "pdf";
      readonly page: number;
      readonly characterStart: number;
      readonly characterEnd: number;
    }
  | {
      readonly kind: "web";
      readonly url: string;
      readonly paragraph: number;
      readonly characterStart: number;
      readonly characterEnd: number;
    }
  | {
      readonly kind: "text";
      readonly startLine: number;
      readonly endLine: number;
      readonly characterStart: number;
      readonly characterEnd: number;
    };

export interface Citation {
  readonly id: string;
  readonly messageId: string;
  readonly passageId: string;
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly label: string;
  readonly locator: SourceLocator;
  readonly excerpt: string;
}

export interface Message {
  readonly id: string;
  readonly conversationId: string;
  readonly role: "researcher" | "assistant";
  readonly status: "pending" | "completed" | "failed";
  readonly content: string;
  readonly citations: readonly Citation[];
  readonly createdAt: string;
}

export interface Conversation {
  readonly id: string;
  readonly notebookId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ConversationDetail extends Conversation {
  readonly messages: readonly Message[];
}

export interface Note {
  readonly id: string;
  readonly notebookId: string;
  readonly title: string;
  readonly content: string;
  readonly sourceMessageId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProviderConfiguration {
  readonly kind: "chat" | "embedding";
  readonly baseUrl: string;
  readonly model: string;
  readonly hasApiKey: boolean;
  readonly source: "database" | "environment" | "missing";
}

export type AnswerEvent =
  | { readonly type: "answer.started"; readonly messageId: string }
  | { readonly type: "answer.delta"; readonly delta: string }
  | { readonly type: "citation"; readonly citation: Citation }
  | { readonly type: "answer.completed"; readonly message: Message }
  | { readonly type: "answer.failed"; readonly code: string; readonly message: string };
