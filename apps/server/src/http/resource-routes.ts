import { extname } from "node:path";
import { ApplicationError, type SourceKind } from "@cangshu/application";
import type { Multipart } from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpServices } from "./http-host-plugin.js";
import { sendSuccess } from "./http-host-plugin.js";

const id = z.uuid();
const notebookParams = z.object({ notebookId: id }).strict();
const sourceParams = z.object({ notebookId: id, sourceId: id }).strict();
const notebookBody = z.object({ name: z.string().trim().min(1).max(120) }).strict();
const textBody = z
  .object({
    title: z.string().trim().min(1).max(240),
    text: z.string().max(5 * 1024 * 1024),
    kind: z.enum(["text", "markdown"]).optional(),
  })
  .strict();
const urlBody = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    url: z.url({ protocol: /^https?$/ }),
  })
  .strict();

export function registerResourceRoutes(app: FastifyInstance, services: HttpServices): void {
  app.get("/api/notebooks", async (request, reply) =>
    sendSuccess(request, reply, await services.notebooks.list()),
  );
  app.post("/api/notebooks", async (request, reply) => {
    const body = notebookBody.parse(request.body);
    return sendSuccess(request, reply, await services.notebooks.create(body.name), 201);
  });
  app.get("/api/notebooks/:notebookId", async (request, reply) => {
    const params = notebookParams.parse(request.params);
    return sendSuccess(request, reply, await services.notebooks.get(params.notebookId));
  });
  app.patch("/api/notebooks/:notebookId", async (request, reply) => {
    const params = notebookParams.parse(request.params);
    const body = notebookBody.parse(request.body);
    return sendSuccess(
      request,
      reply,
      await services.notebooks.rename(params.notebookId, body.name),
    );
  });
  app.delete("/api/notebooks/:notebookId", async (request, reply) => {
    const params = notebookParams.parse(request.params);
    await services.notebooks.delete(params.notebookId);
    return sendSuccess(request, reply, { deleted: true });
  });

  app.get("/api/notebooks/:notebookId/sources", async (request, reply) => {
    const params = notebookParams.parse(request.params);
    return sendSuccess(request, reply, await services.sources.list(params.notebookId));
  });
  app.get("/api/notebooks/:notebookId/sources/:sourceId", async (request, reply) => {
    const params = sourceParams.parse(request.params);
    return sendSuccess(
      request,
      reply,
      await services.sources.get(params.notebookId, params.sourceId),
    );
  });
  app.post("/api/notebooks/:notebookId/sources/text", async (request, reply) => {
    const params = notebookParams.parse(request.params);
    const body = textBody.parse(request.body);
    return sendSuccess(
      request,
      reply,
      await services.sources.importText({
        notebookId: params.notebookId,
        title: body.title,
        text: body.text,
        ...(body.kind ? { kind: body.kind } : {}),
      }),
      201,
    );
  });
  app.post("/api/notebooks/:notebookId/sources/url", async (request, reply) => {
    const params = notebookParams.parse(request.params);
    const body = urlBody.parse(request.body);
    return sendSuccess(
      request,
      reply,
      await services.sources.importUrl({
        notebookId: params.notebookId,
        url: body.url,
        ...(body.title ? { title: body.title } : {}),
      }),
      201,
    );
  });
  app.post("/api/notebooks/:notebookId/sources/upload", async (request, reply) => {
    const params = notebookParams.parse(request.params);
    const upload = await readUpload(request.parts());
    return sendSuccess(
      request,
      reply,
      await services.sources.importBytes({
        notebookId: params.notebookId,
        title: upload.title,
        kind: upload.kind,
        mimeType: upload.mimeType,
        bytes: upload.bytes,
      }),
      201,
    );
  });
  app.post("/api/notebooks/:notebookId/sources/:sourceId/retry", async (request, reply) => {
    const params = sourceParams.parse(request.params);
    return sendSuccess(
      request,
      reply,
      await services.sources.retry(params.notebookId, params.sourceId),
    );
  });
  app.delete("/api/notebooks/:notebookId/sources/:sourceId", async (request, reply) => {
    const params = sourceParams.parse(request.params);
    await services.sources.delete(params.notebookId, params.sourceId);
    return sendSuccess(request, reply, { deleted: true });
  });
}

async function readUpload(parts: AsyncIterable<Multipart>) {
  let title = "";
  let file:
    | { readonly filename: string; readonly mimetype: string; readonly bytes: Uint8Array }
    | undefined;
  try {
    for await (const part of parts) {
      if (part.type === "field") {
        if (part.fieldname === "title" && typeof part.value === "string") {
          title = part.value;
        }
        continue;
      }
      if (file) {
        throw validation("Only one upload file is allowed.");
      }
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) {
        chunks.push(Buffer.from(chunk));
      }
      if (part.file.truncated) {
        throw tooLarge();
      }
      file = {
        filename: part.filename,
        mimetype: part.mimetype,
        bytes: Buffer.concat(chunks),
      };
    }
  } catch (error) {
    if (hasCode(error, "FST_REQ_FILE_TOO_LARGE")) {
      throw tooLarge();
    }
    throw error;
  }
  if (!file) {
    throw validation("A file field is required.");
  }
  const normalizedTitle = title.trim() || file.filename.trim();
  if (normalizedTitle.length === 0 || normalizedTitle.length > 240) {
    throw validation("Upload title must contain 1 through 240 characters.");
  }
  const detected = detectUpload(file.filename, file.mimetype, file.bytes);
  return { title: normalizedTitle, bytes: file.bytes, ...detected };
}

function detectUpload(
  filename: string,
  suppliedMimeType: string,
  bytes: Uint8Array,
): { kind: Extract<SourceKind, "pdf" | "text" | "markdown">; mimeType: string } {
  const extension = extname(filename).toLowerCase();
  const looksLikePdf = Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-";
  if (extension === ".pdf" || suppliedMimeType === "application/pdf") {
    if (!looksLikePdf) throw unsupported("Uploaded PDF does not have a valid PDF signature.");
    return { kind: "pdf", mimeType: "application/pdf" };
  }
  const markdown = extension === ".md" || extension === ".markdown";
  const text = extension === ".txt" || suppliedMimeType.startsWith("text/");
  if (!markdown && !text) {
    throw unsupported("Uploaded file type is not supported.");
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (decoded.includes("\0")) throw new Error("binary text");
  } catch {
    throw unsupported("Uploaded text file is not valid UTF-8.");
  }
  return markdown
    ? { kind: "markdown", mimeType: "text/markdown" }
    : { kind: "text", mimeType: "text/plain" };
}

function validation(message: string): ApplicationError {
  return new ApplicationError({ code: "VALIDATION_ERROR", message, status: 400 });
}

function unsupported(message: string): ApplicationError {
  return new ApplicationError({ code: "SOURCE_TYPE_UNSUPPORTED", message, status: 422 });
}

function tooLarge(): ApplicationError {
  return new ApplicationError({
    code: "SOURCE_TOO_LARGE",
    message: "Uploaded file exceeds the 50 MiB limit.",
    status: 413,
  });
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
