import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApplicationError } from "@cangshu/application";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createHttpApp,
  type HttpLogRecord,
  type HttpServices,
} from "../src/http/http-host-plugin.js";

const services = {} as HttpServices;

describe("HttpHost", () => {
  it("serves the built Web app and preserves API 404 envelopes", async () => {
    const root = await mkdtemp(join(tmpdir(), "cangshu-web-"));
    await writeFile(join(root, "index.html"), "<!doctype html><title>藏书阁</title>");
    const app = await createHttpApp(services, { staticRoot: root });

    const page = await app.inject({ method: "GET", url: "/research/deep-link" });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("藏书阁");
    const missingApi = await app.inject({ method: "GET", url: "/api/not-real" });
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.json()).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });

    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it("serves unauthenticated liveness and readiness with stable request IDs", async () => {
    let ready = false;
    const app = await createHttpApp(services, { readiness: async () => ready });
    const live = await app.inject({ method: "GET", url: "/api/health/live" });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({
      ok: true,
      data: { status: "alive" },
      requestId: expect.any(String),
    });
    expect(live.headers["x-request-id"]).toBe(live.json().requestId);

    const unavailable = await app.inject({ method: "GET", url: "/api/health/ready" });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({
      ok: false,
      error: { code: "NOT_READY" },
      requestId: expect.any(String),
    });
    ready = true;
    expect((await app.inject({ method: "GET", url: "/api/health/ready" })).statusCode).toBe(200);
    await app.close();
  });

  it("maps Zod and application failures without stacks, causes, or secrets", async () => {
    const app = await createHttpApp(services);
    app.post("/test/validation", async (request) => {
      z.object({ title: z.string().min(1), nested: z.object({ count: z.number().int() }) }).parse(
        request.body,
      );
      return { unreachable: true };
    });
    app.get("/test/application-error", async () => {
      throw new ApplicationError({
        code: "PROVIDER_ERROR",
        message: "Provider request failed.",
        status: 502,
        cause: new Error("Authorization: Bearer private-key"),
      });
    });

    const invalid = await app.inject({
      method: "POST",
      url: "/test/validation",
      payload: { title: "", nested: { count: 1.5 } },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        issues: [{ path: ["title"] }, { path: ["nested", "count"] }],
      },
    });
    const failed = await app.inject({ method: "GET", url: "/test/application-error" });
    expect(failed.statusCode).toBe(502);
    expect(JSON.stringify(failed.json())).not.toContain("private-key");
    expect(JSON.stringify(failed.json())).not.toContain("stack");
    await app.close();
  });

  it("enforces body limits and logs only controlled request metadata", async () => {
    const logs: HttpLogRecord[] = [];
    const app = await createHttpApp(services, {
      bodyLimit: 64,
      logSink: { write: (record) => logs.push(record) },
    });
    app.post("/test/body", async () => ({ ok: true }));

    const response = await app.inject({
      method: "POST",
      url: "/test/body?apiKey=query-secret",
      payload: { content: "body-secret".repeat(10) },
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(JSON.stringify(logs)).not.toContain("body-secret");
    expect(JSON.stringify(logs)).not.toContain("query-secret");
    expect(logs.at(-1)).toMatchObject({ method: "POST", route: "/test/body", statusCode: 413 });
    await app.close();
  });
});
