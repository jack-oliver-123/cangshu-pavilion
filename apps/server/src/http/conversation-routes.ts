import { once } from "node:events";
import { ApplicationError } from "@cangshu/application";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpServices } from "./http-host-plugin.js";
import { sendSuccess } from "./http-host-plugin.js";

const paramsSchema = z
  .object({ notebookId: z.uuid(), conversationId: z.uuid().optional() })
  .strict();
const createSchema = z.object({ title: z.string().trim().min(1).max(160).optional() }).strict();
const answerSchema = z.object({ question: z.string().trim().min(1).max(8_000) }).strict();

export function registerConversationRoutes(app: FastifyInstance, services: HttpServices): void {
  app.get("/api/notebooks/:notebookId/conversations", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    return sendSuccess(
      request,
      reply,
      await services.research.listConversations(params.notebookId),
    );
  });
  app.post("/api/notebooks/:notebookId/conversations", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const body = createSchema.parse(request.body);
    return sendSuccess(
      request,
      reply,
      await services.research.createConversation(params.notebookId, body.title),
      201,
    );
  });
  app.get("/api/notebooks/:notebookId/conversations/:conversationId", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    if (!params.conversationId) throw validation("conversationId is required.");
    return sendSuccess(
      request,
      reply,
      await services.research.getConversation(params.notebookId, params.conversationId),
    );
  });
  app.post(
    "/api/notebooks/:notebookId/conversations/:conversationId/answer",
    async (request, reply) => {
      const params = paramsSchema.parse(request.params);
      const body = answerSchema.parse(request.body);
      if (!params.conversationId) throw validation("conversationId is required.");
      await services.research.getConversation(params.notebookId, params.conversationId);
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "x-request-id": request.id,
      });

      const stream = services.research.answer({
        notebookId: params.notebookId,
        conversationId: params.conversationId,
        question: body.question,
      });
      let disconnected = false;
      let terminal = false;
      reply.raw.once("close", () => {
        disconnected = true;
      });
      try {
        for await (const event of stream) {
          if (disconnected || reply.raw.destroyed) break;
          await writeSse(reply.raw, event.type, event);
          if (event.type === "answer.completed" || event.type === "answer.failed") {
            terminal = true;
          }
        }
      } catch {
        if (!disconnected && !reply.raw.destroyed) {
          await writeSse(reply.raw, "answer.failed", {
            type: "answer.failed",
            code: "INTERNAL_ERROR",
            message: "回答流意外中断。",
          });
          terminal = true;
        }
      } finally {
        await stream.return(undefined).catch(() => undefined);
        if (!terminal && !disconnected && !reply.raw.destroyed) {
          await writeSse(reply.raw, "answer.failed", {
            type: "answer.failed",
            code: "INTERNAL_ERROR",
            message: "回答流未返回终止事件。",
          });
        }
        if (!reply.raw.destroyed) reply.raw.end();
      }
    },
  );
}

async function writeSse(
  response: NodeJS.WritableStream & { write(chunk: string): boolean },
  event: string,
  data: unknown,
): Promise<void> {
  if (!response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) {
    await once(response, "drain");
  }
}

function validation(message: string): ApplicationError {
  return new ApplicationError({ code: "VALIDATION_ERROR", message, status: 400 });
}
