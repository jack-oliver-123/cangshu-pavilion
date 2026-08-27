import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { ApplicationError } from "@cangshu/application";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { sendSuccess } from "./http-host-plugin.js";

export interface PasswordVerifier {
  verify(candidate: string, expected: string): boolean | Promise<boolean>;
}

export interface RemoteAuthOptions {
  readonly sharedPassword: string;
  readonly sessionTtlMs?: number;
  readonly loginRateMax?: number;
  readonly now?: () => number;
  readonly verifier?: PasswordVerifier;
  readonly secureCookie?: boolean;
}

const COOKIE_NAME = "cangshu_session";
const loginBody = z.object({ password: z.string().min(1).max(32_768) }).strict();

export async function registerRemoteAuth(
  app: FastifyInstance,
  options: RemoteAuthOptions,
): Promise<void> {
  const sessionTtlMs = positiveInteger(options.sessionTtlMs ?? 8 * 60 * 60_000, "sessionTtlMs");
  const loginRateMax = positiveInteger(options.loginRateMax ?? 5, "loginRateMax");
  const now = options.now ?? Date.now;
  const verifier = options.verifier ?? { verify: verifySharedPassword };
  const signingSecret = createHash("sha256")
    .update("cangshu-session-signing-v1\0")
    .update(options.sharedPassword)
    .digest("base64url");
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure: options.secureCookie ?? false,
    signed: true,
  };

  await app.register(cookie, { secret: signingSecret, hook: "onRequest" });
  await app.register(rateLimit, { global: false });

  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: loginRateMax, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = loginBody.parse(request.body);
      if (!(await verifier.verify(body.password, options.sharedPassword))) {
        throw unauthorized("Shared password is invalid.", 401);
      }
      const payload = Buffer.from(
        JSON.stringify({ v: 1, nonce: randomUUID(), exp: now() + sessionTtlMs }),
        "utf8",
      ).toString("base64url");
      reply.setCookie(COOKIE_NAME, payload, {
        ...cookieOptions,
        maxAge: Math.ceil(sessionTtlMs / 1_000),
      });
      return sendSuccess(request, reply, { authenticated: true });
    },
  );
  app.post("/api/auth/logout", async (request, reply) => {
    reply.clearCookie(COOKIE_NAME, cookieOptions);
    return sendSuccess(request, reply, { authenticated: false });
  });
  app.get("/api/auth/session", async (request, reply) =>
    sendSuccess(request, reply, { authenticated: true }),
  );

  app.addHook("preHandler", async (request) => {
    const route = request.routeOptions.url ?? "";
    if (route.startsWith("/api/health/") || route === "/api/auth/login") {
      return;
    }
    validateSession(request, now());
    if (isUnsafeMethod(request.method)) {
      enforceSameOrigin(request);
    }
  });
}

export function verifySharedPassword(candidate: string, expected: string): boolean {
  const key = "cangshu-password-verification-v1";
  const candidateDigest = createHmac("sha256", key).update(candidate, "utf8").digest();
  const expectedDigest = createHmac("sha256", key).update(expected, "utf8").digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

function validateSession(request: FastifyRequest, now: number): void {
  const signed = request.cookies[COOKIE_NAME];
  if (!signed) throw unauthorized("Authentication is required.", 401);
  const unsigned = request.unsignCookie(signed);
  if (!unsigned.valid || !unsigned.value) throw unauthorized("Session is invalid.", 401);
  try {
    const value: unknown = JSON.parse(Buffer.from(unsigned.value, "base64url").toString("utf8"));
    if (
      typeof value !== "object" ||
      value === null ||
      !("v" in value) ||
      value.v !== 1 ||
      !("nonce" in value) ||
      typeof value.nonce !== "string" ||
      !("exp" in value) ||
      typeof value.exp !== "number" ||
      !Number.isSafeInteger(value.exp) ||
      value.exp <= now
    ) {
      throw new Error("invalid session");
    }
  } catch {
    throw unauthorized("Session is invalid or expired.", 401);
  }
}

function enforceSameOrigin(request: FastifyRequest): void {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) throw unauthorized("A same-origin request is required.", 403);
  try {
    const submitted = new URL(origin).origin;
    const expected = new URL(`${request.protocol}://${host}`).origin;
    if (submitted !== expected) throw new Error("origin mismatch");
  } catch {
    throw unauthorized("A same-origin request is required.", 403);
  }
}

function isUnsafeMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function unauthorized(message: string, status: 401 | 403): ApplicationError {
  return new ApplicationError({ code: "UNAUTHORIZED", message, status });
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return value;
}
