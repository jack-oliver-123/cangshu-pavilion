import { definePlugin, noConfig } from "@cangshu/plugin-kernel";
import { z } from "zod";
import { NOTE_MANAGEMENT, type NoteManagement } from "../capabilities.js";
import { ApplicationError, notFound } from "../errors.js";
import type { ConversationRepository, NoteRepository } from "../ports.js";
import { formatLocator } from "./research-answering.js";

const titleSchema = z.string().trim().min(1).max(240);
const contentSchema = z.string().max(2_000_000);

export function noteManagementPlugin(input: {
  notes: NoteRepository;
  conversations: ConversationRepository;
}) {
  return definePlugin({
    id: "note-management",
    provides: NOTE_MANAGEMENT,
    requires: {},
    config: noConfig,
    setup(): NoteManagement {
      return {
        list: (notebookId) => input.notes.list(notebookId),
        async get(notebookId, noteId) {
          const note = await input.notes.find(notebookId, noteId);
          if (!note) {
            throw notFound("Note", noteId);
          }
          return note;
        },
        create(request) {
          return input.notes.create({
            notebookId: request.notebookId,
            title: titleSchema.parse(request.title),
            content: contentSchema.parse(request.content),
          });
        },
        async saveAnswer(request) {
          const message = await input.conversations.findMessage(
            request.notebookId,
            request.messageId,
          );
          if (!message) {
            throw notFound("Message", request.messageId);
          }
          if (message.role !== "assistant" || message.status !== "completed") {
            throw new ApplicationError({
              code: "CONFLICT",
              message: "Only a completed Grounded Answer can be saved as a Note.",
              status: 409,
            });
          }
          const citationSection = message.citations.length
            ? `\n\n## 引用\n\n${message.citations
                .map(
                  (citation) =>
                    `- [${citation.label}] **${citation.sourceTitle}**，${formatLocator(citation.locator)}\n\n  > ${citation.excerpt.replace(/\n/g, " ")}`,
                )
                .join("\n")}`
            : "";
          return input.notes.create({
            notebookId: request.notebookId,
            title: titleSchema.parse(request.title ?? "研究答案"),
            content: `${message.content}${citationSection}`,
            sourceMessageId: message.id,
          });
        },
        async update(notebookId, noteId, changes) {
          const parsed = {
            ...(changes.title === undefined ? {} : { title: titleSchema.parse(changes.title) }),
            ...(changes.content === undefined
              ? {}
              : { content: contentSchema.parse(changes.content) }),
          };
          const note = await input.notes.update(notebookId, noteId, parsed);
          if (!note) {
            throw notFound("Note", noteId);
          }
          return note;
        },
        async delete(notebookId, noteId) {
          if (!(await input.notes.delete(notebookId, noteId))) {
            throw notFound("Note", noteId);
          }
        },
      };
    },
  });
}
