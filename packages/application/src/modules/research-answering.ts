import { definePlugin, noConfig } from "@cangshu/plugin-kernel";
import { z } from "zod";
import { RESEARCH_ANSWERING, type ResearchAnswering } from "../capabilities.js";
import type { Citation, PassageCandidate } from "../domain.js";
import { ApplicationError, notFound } from "../errors.js";
import type {
  ChatPassage,
  ConversationRepository,
  ModelProviderResolver,
  SourceRepository,
} from "../ports.js";

const questionSchema = z.string().trim().min(1).max(8_000);
const conversationTitleSchema = z.string().trim().min(1).max(160);
const INSUFFICIENT_EVIDENCE = "当前 Notebook 中的材料不足以可靠回答这个问题。";

export function researchAnsweringPlugin(input: {
  conversations: ConversationRepository;
  sources: SourceRepository;
  models: ModelProviderResolver;
}) {
  return definePlugin({
    id: "research-answering",
    provides: RESEARCH_ANSWERING,
    requires: {},
    config: noConfig,
    setup(): ResearchAnswering {
      return {
        listConversations: (notebookId) => input.conversations.list(notebookId),
        async getConversation(notebookId, conversationId) {
          const conversation = await input.conversations.find(notebookId, conversationId);
          if (!conversation) {
            throw notFound("Conversation", conversationId);
          }
          return conversation;
        },
        createConversation(notebookId, title) {
          return input.conversations.create(
            notebookId,
            conversationTitleSchema.parse(title ?? "新对话"),
          );
        },
        async *answer(request) {
          const question = questionSchema.parse(request.question);
          const conversation = await input.conversations.find(
            request.notebookId,
            request.conversationId,
          );
          if (!conversation) {
            throw notFound("Conversation", request.conversationId);
          }
          await input.conversations.addMessage({
            notebookId: request.notebookId,
            conversationId: request.conversationId,
            role: "researcher",
            status: "completed",
            content: question,
          });
          const pending = await input.conversations.addMessage({
            notebookId: request.notebookId,
            conversationId: request.conversationId,
            role: "assistant",
            status: "pending",
            content: "",
          });
          let terminal = false;
          try {
            yield { type: "answer.started", messageId: pending.id };
            const embeddingModel = await input.models.embedding();
            const [questionEmbedding] = await embeddingModel.embed([question]);
            if (!questionEmbedding) {
              throw new Error("Embedding Provider returned no query vector.");
            }
            const candidates = await input.sources.searchPassages({
              notebookId: request.notebookId,
              embedding: questionEmbedding,
              embeddingModel: embeddingModel.modelKey,
              limit: 16,
            });
            const evidence = diversifyEvidence(candidates, 8, 4);
            if (evidence.length === 0) {
              const message = await input.conversations.completeAssistantMessage({
                notebookId: request.notebookId,
                conversationId: request.conversationId,
                messageId: pending.id,
                content: INSUFFICIENT_EVIDENCE,
                citations: [],
              });
              terminal = true;
              yield { type: "answer.delta", delta: INSUFFICIENT_EVIDENCE };
              yield { type: "answer.completed", message };
              return;
            }

            const passages = evidence.map(toChatPassage);
            const allowedLabels = new Map(
              passages.map((passage, index) => [passage.label, evidence[index]]),
            );
            const chat = await input.models.chat();
            let completedContent = "";
            let citedLabels: readonly string[] = [];
            for await (const event of chat.stream({
              question,
              history: conversation.messages
                .filter((message) => message.status === "completed")
                .slice(-8)
                .map((message) => ({ role: message.role, content: message.content })),
              passages,
            })) {
              if (event.type === "delta") {
                yield { type: "answer.delta", delta: event.delta };
              } else {
                completedContent = event.content.trim();
                citedLabels = event.citedLabels;
              }
            }

            const contentLabels = [...completedContent.matchAll(/\[P(\d+)\]/g)].map(
              (match) => `P${match[1]}`,
            );
            const requestedLabels = [...new Set([...citedLabels, ...contentLabels])];
            const hasInvalidLabel = requestedLabels.some((label) => !allowedLabels.has(label));
            const validLabels = requestedLabels.filter((label) => allowedLabels.has(label));
            if (hasInvalidLabel || validLabels.length === 0) {
              completedContent = INSUFFICIENT_EVIDENCE;
              validLabels.length = 0;
            }
            const preparedCitations = validLabels.flatMap((label) => {
              const passage = allowedLabels.get(label);
              return passage ? [toCitation(label, passage)] : [];
            });
            const message = await input.conversations.completeAssistantMessage({
              notebookId: request.notebookId,
              conversationId: request.conversationId,
              messageId: pending.id,
              content: completedContent,
              citations: preparedCitations,
            });
            terminal = true;
            for (const citation of message.citations) {
              yield { type: "citation", citation };
            }
            yield { type: "answer.completed", message };
          } catch (error) {
            terminal = true;
            await input.conversations.failAssistantMessage({
              notebookId: request.notebookId,
              conversationId: request.conversationId,
              messageId: pending.id,
              content: "回答生成失败，请稍后重试。",
            });
            const code = error instanceof ApplicationError ? error.code : "PROVIDER_ERROR";
            yield {
              type: "answer.failed",
              code,
              message: "回答生成失败，请稍后重试。",
            };
          } finally {
            if (!terminal) {
              await input.conversations.failAssistantMessage({
                notebookId: request.notebookId,
                conversationId: request.conversationId,
                messageId: pending.id,
                content: "回答已取消。",
              });
            }
          }
        },
      };
    },
  });
}

export function diversifyEvidence(
  candidates: readonly PassageCandidate[],
  totalLimit: number,
  perSourceLimit: number,
): readonly PassageCandidate[] {
  const counts = new Map<string, number>();
  const selected: PassageCandidate[] = [];
  for (const candidate of candidates) {
    const count = counts.get(candidate.sourceId) ?? 0;
    if (count >= perSourceLimit) {
      continue;
    }
    selected.push(candidate);
    counts.set(candidate.sourceId, count + 1);
    if (selected.length >= totalLimit) {
      break;
    }
  }
  return selected;
}

function toChatPassage(passage: PassageCandidate, index: number): ChatPassage {
  return {
    label: `P${index + 1}`,
    passageId: passage.id,
    sourceTitle: passage.sourceTitle,
    locator: formatLocator(passage.locator),
    content: passage.content,
  };
}

function toCitation(label: string, passage: PassageCandidate): Omit<Citation, "id" | "messageId"> {
  return {
    passageId: passage.id,
    sourceId: passage.sourceId,
    sourceTitle: passage.sourceTitle,
    label,
    locator: passage.locator,
    excerpt: passage.content.slice(0, 700),
  };
}

export function formatLocator(locator: PassageCandidate["locator"]): string {
  if (locator.kind === "pdf") {
    return `第 ${locator.page} 页`;
  }
  if (locator.kind === "web") {
    return `第 ${locator.paragraph} 段`;
  }
  return `第 ${locator.startLine}-${locator.endLine} 行`;
}
