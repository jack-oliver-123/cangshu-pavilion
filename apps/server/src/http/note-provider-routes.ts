import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpServices } from "./http-host-plugin.js";
import { sendSuccess } from "./http-host-plugin.js";

const notebookParams = z.object({ notebookId: z.uuid() }).strict();
const noteParams = z.object({ notebookId: z.uuid(), noteId: z.uuid() }).strict();
const messageParams = z.object({ notebookId: z.uuid(), messageId: z.uuid() }).strict();
const providerParams = z.object({ kind: z.enum(["chat", "embedding"]) }).strict();
const noteCreate = z
  .object({
    title: z.string().trim().min(1).max(240),
    content: z.string().max(2_000_000),
  })
  .strict();
const noteUpdate = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    content: z.string().max(2_000_000).optional(),
  })
  .strict()
  .refine((value) => value.title !== undefined || value.content !== undefined, {
    message: "At least one Note field is required.",
  });
const saveAnswer = z.object({ title: z.string().trim().min(1).max(240).optional() }).strict();
const providerBody = z
  .object({
    baseUrl: z.url({ protocol: /^https?$/ }),
    model: z.string().trim().min(1).max(240),
    apiKey: z.string().max(32_768).optional(),
  })
  .strict();

export function registerNoteProviderRoutes(app: FastifyInstance, services: HttpServices): void {
  app.get("/api/notebooks/:notebookId/notes", async (request, reply) => {
    const params = notebookParams.parse(request.params);
    return sendSuccess(request, reply, await services.notes.list(params.notebookId));
  });
  app.post("/api/notebooks/:notebookId/notes", async (request, reply) => {
    const params = notebookParams.parse(request.params);
    const body = noteCreate.parse(request.body);
    return sendSuccess(
      request,
      reply,
      await services.notes.create({ notebookId: params.notebookId, ...body }),
      201,
    );
  });
  app.get("/api/notebooks/:notebookId/notes/:noteId", async (request, reply) => {
    const params = noteParams.parse(request.params);
    return sendSuccess(request, reply, await services.notes.get(params.notebookId, params.noteId));
  });
  app.patch("/api/notebooks/:notebookId/notes/:noteId", async (request, reply) => {
    const params = noteParams.parse(request.params);
    const body = noteUpdate.parse(request.body);
    return sendSuccess(
      request,
      reply,
      await services.notes.update(params.notebookId, params.noteId, {
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(body.content === undefined ? {} : { content: body.content }),
      }),
    );
  });
  app.delete("/api/notebooks/:notebookId/notes/:noteId", async (request, reply) => {
    const params = noteParams.parse(request.params);
    await services.notes.delete(params.notebookId, params.noteId);
    return sendSuccess(request, reply, { deleted: true });
  });
  app.post("/api/notebooks/:notebookId/messages/:messageId/note", async (request, reply) => {
    const params = messageParams.parse(request.params);
    const body = saveAnswer.parse(request.body ?? {});
    return sendSuccess(
      request,
      reply,
      await services.notes.saveAnswer({
        notebookId: params.notebookId,
        messageId: params.messageId,
        ...(body.title ? { title: body.title } : {}),
      }),
      201,
    );
  });

  app.get("/api/providers", async (request, reply) =>
    sendSuccess(request, reply, await services.providers.list()),
  );
  app.put("/api/providers/:kind", async (request, reply) => {
    const params = providerParams.parse(request.params);
    const body = providerBody.parse(request.body);
    const input = {
      kind: params.kind,
      baseUrl: body.baseUrl,
      model: body.model,
      ...(body.apiKey === undefined ? {} : { apiKey: body.apiKey }),
    };
    return sendSuccess(request, reply, await services.providers.save(input));
  });
  app.post("/api/providers/:kind/test", async (request, reply) => {
    const params = providerParams.parse(request.params);
    const body = providerBody.parse(request.body);
    await services.providers.test({
      kind: params.kind,
      baseUrl: body.baseUrl,
      model: body.model,
      ...(body.apiKey === undefined ? {} : { apiKey: body.apiKey }),
    });
    return sendSuccess(request, reply, { tested: true });
  });
}
