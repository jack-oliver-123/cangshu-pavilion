import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ApplicationError,
  NOTE_MANAGEMENT,
  NOTEBOOK_MANAGEMENT,
  type NotebookManagement,
  type NoteManagement,
  PROVIDER_SETTINGS,
  type ProviderSettingsManagement,
  RESEARCH_ANSWERING,
  type ResearchAnswering,
  SOURCE_INGESTION,
  type SourceIngestion,
} from "@cangshu/application";
import { defineCapability, definePlugin, noConfig } from "@cangshu/plugin-kernel";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { registerConversationRoutes } from "./conversation-routes.js";
import { registerNoteProviderRoutes } from "./note-provider-routes.js";
import { type RemoteAuthOptions, registerRemoteAuth } from "./remote-auth.js";
import { registerResourceRoutes } from "./resource-routes.js";

export interface HttpServices {
  readonly notebooks: NotebookManagement;
  readonly sources: SourceIngestion;
  readonly research: ResearchAnswering;
  readonly notes: NoteManagement;
  readonly providers: ProviderSettingsManagement;
}

export interface HttpHost {
  readonly address: string;
}

export const HTTP_HOST = defineCapability<HttpHost>("cangshu.http-host");

export interface HttpLogRecord {
  readonly event: "http.request";
  readonly requestId: string;
  readonly method: string;
  readonly route: string;
  readonly statusCode: number;
}

export interface HttpLogSink {
  write(record: HttpLogRecord): void;
}

export interface HttpAppOptions {
  readonly readiness?: () => boolean | Promise<boolean>;
  readonly bodyLimit?: number;
  readonly multipartFileLimit?: number;
  readonly remoteAuth?: RemoteAuthOptions;
  readonly logSink?: HttpLogSink;
  readonly staticRoot?: string;
}

export interface HttpHostPluginOptions extends HttpAppOptions {
  readonly host: string;
  readonly port: number;
}

export async function createHttpApp(
  services: HttpServices,
  options: HttpAppOptions = {},
): Promise<FastifyInstance> {
  void services;
  const webIndex = options.staticRoot
    ? await readFile(join(options.staticRoot, "index.html"), "utf8")
    : undefined;
  const app = Fastify({
    logger: false,
    bodyLimit: options.bodyLimit ?? 6 * 1024 * 1024,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });
  app.addHook("onResponse", async (request, reply) => {
    if (!options.logSink) return;
    try {
      options.logSink.write({
        event: "http.request",
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url || "unmatched",
        statusCode: reply.statusCode,
      });
    } catch {
      // Observability must not change request behavior.
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const mapped = mapHttpError(error);
    void reply.status(mapped.status).send({
      ok: false,
      error: mapped.error,
      requestId: request.id,
    });
  });
  app.setNotFoundHandler((request, reply) => {
    if (webIndex !== undefined && !request.url.startsWith("/api/")) {
      return reply.type("text/html; charset=utf-8").send(webIndex);
    }
    void reply.status(404).send({
      ok: false,
      error: { code: "NOT_FOUND", message: "HTTP route was not found." },
      requestId: request.id,
    });
  });

  app.get("/api/health/live", async (request, reply) =>
    sendSuccess(request, reply, { status: "alive" }),
  );
  app.get("/api/health/ready", async (request, reply) => {
    const ready = await (options.readiness?.() ?? true);
    if (!ready) {
      throw new ApplicationError({
        code: "NOT_READY",
        message: "Application dependencies are not ready.",
        status: 503,
      });
    }
    return sendSuccess(request, reply, { status: "ready" });
  });

  await app.register(multipart, {
    limits: {
      files: 1,
      fields: 8,
      fileSize: options.multipartFileLimit ?? 50 * 1024 * 1024,
    },
    throwFileSizeLimit: true,
  });
  if (options.staticRoot) {
    await app.register(staticFiles, { root: options.staticRoot, prefix: "/" });
  }
  if (options.remoteAuth) {
    await registerRemoteAuth(app, options.remoteAuth);
  }
  registerResourceRoutes(app, services);
  registerConversationRoutes(app, services);
  registerNoteProviderRoutes(app, services);

  return app;
}

export function httpHostPlugin(options: HttpHostPluginOptions) {
  return definePlugin({
    id: "http-host",
    provides: HTTP_HOST,
    requires: {
      notebooks: NOTEBOOK_MANAGEMENT,
      sources: SOURCE_INGESTION,
      research: RESEARCH_ANSWERING,
      notes: NOTE_MANAGEMENT,
      providers: PROVIDER_SETTINGS,
    },
    config: noConfig,
    async setup({ dependencies, lifetime }): Promise<HttpHost> {
      const app = lifetime.own(await createHttpApp(dependencies, options), async (owned) =>
        owned.close(),
      );
      const address = await app.listen({ host: options.host, port: options.port });
      return Object.freeze({ address });
    },
  });
}

export function sendSuccess<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  data: T,
  status = 200,
) {
  return reply.status(status).send({ ok: true, data, requestId: request.id });
}

function mapHttpError(error: unknown): {
  status: number;
  error: Readonly<Record<string, unknown>>;
} {
  if (error instanceof ZodError) {
    return {
      status: 400,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        issues: error.issues.map((issue) => ({
          path: issue.path.filter(
            (segment): segment is string | number =>
              typeof segment === "string" || typeof segment === "number",
          ),
          code: issue.code,
          message: issue.message,
        })),
      },
    };
  }
  if (error instanceof ApplicationError) {
    return {
      status: error.status,
      error: { code: error.code, message: error.message },
    };
  }
  const coded =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown; statusCode?: unknown })
      : {};
  if (coded.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
    return {
      status: 413,
      error: { code: "VALIDATION_ERROR", message: "Request body exceeds the size limit." },
    };
  }
  if (typeof coded.statusCode === "number" && coded.statusCode >= 400 && coded.statusCode < 500) {
    if (coded.statusCode === 429) {
      return {
        status: 429,
        error: { code: "RATE_LIMITED", message: "Too many requests." },
      };
    }
    return {
      status: coded.statusCode,
      error: { code: "VALIDATION_ERROR", message: "Request could not be parsed." },
    };
  }
  return {
    status: 500,
    error: { code: "INTERNAL_ERROR", message: "An internal error occurred." },
  };
}
