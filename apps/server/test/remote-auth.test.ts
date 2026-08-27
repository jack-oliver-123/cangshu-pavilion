import type {
  NotebookManagement,
  NoteManagement,
  ProviderSettingsManagement,
  ResearchAnswering,
  SourceIngestion,
} from "@cangshu/application";
import { describe, expect, it, vi } from "vitest";
import { createHttpApp, type HttpServices } from "../src/http/http-host-plugin.js";
import { verifySharedPassword } from "../src/http/remote-auth.js";

const services = {
  notebooks: { list: vi.fn(async () => []) } as unknown as NotebookManagement,
  sources: {} as SourceIngestion,
  research: {} as ResearchAnswering,
  notes: {} as NoteManagement,
  providers: {} as ProviderSettingsManagement,
} satisfies HttpServices;

describe("remote shared-session authentication", () => {
  it("protects non-health routes, rate-limits login, and uses a signed strict Cookie", async () => {
    const verifier = { verify: vi.fn(verifySharedPassword) };
    const app = await createHttpApp(services, {
      remoteAuth: {
        sharedPassword: "correct-shared-password",
        loginRateMax: 2,
        verifier,
      },
    });

    expect((await app.inject({ method: "GET", url: "/api/health/live" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/notebooks" })).statusCode).toBe(401);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { password: "wrong-password" },
          })
        ).statusCode,
      ).toBe(401);
    }
    const limited = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "correct-shared-password" },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(verifier.verify).toHaveBeenCalledTimes(2);
    await app.close();

    const loginApp = await createHttpApp(services, {
      remoteAuth: { sharedPassword: "correct-shared-password" },
    });
    const login = await loginApp.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "correct-shared-password" },
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers["set-cookie"];
    expect(setCookie).toContain("cangshu_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    const cookie = String(setCookie).split(";", 1)[0];
    expect(
      (await loginApp.inject({ method: "GET", url: "/api/notebooks", headers: { cookie } }))
        .statusCode,
    ).toBe(200);

    const tampered = `${cookie}x`;
    expect(
      (
        await loginApp.inject({
          method: "GET",
          url: "/api/notebooks",
          headers: { cookie: tampered },
        })
      ).statusCode,
    ).toBe(401);
    await loginApp.close();
  });

  it("requires same-origin on authenticated writes and clears the browser session on logout", async () => {
    const app = await createHttpApp(services, {
      remoteAuth: { sharedPassword: "correct-shared-password" },
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "correct-shared-password" },
    });
    const cookie = String(login.headers["set-cookie"]).split(";", 1)[0];

    const missingOrigin = await app.inject({
      method: "POST",
      url: "/api/notebooks",
      headers: { cookie },
      payload: { name: "Remote" },
    });
    expect(missingOrigin.statusCode).toBe(403);
    const wrongOrigin = await app.inject({
      method: "POST",
      url: "/api/notebooks",
      headers: { cookie, origin: "https://evil.example" },
      payload: { name: "Remote" },
    });
    expect(wrongOrigin.statusCode).toBe(403);

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie, origin: "http://localhost:80" },
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");
    await app.close();
  });

  it("expires sessions at a bounded timestamp", async () => {
    let now = Date.parse("2026-08-27T00:00:00.000Z");
    const app = await createHttpApp(services, {
      remoteAuth: {
        sharedPassword: "correct-shared-password",
        sessionTtlMs: 1_000,
        now: () => now,
      },
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "correct-shared-password" },
    });
    const cookie = String(login.headers["set-cookie"]).split(";", 1)[0];
    now += 1_001;
    expect(
      (await app.inject({ method: "GET", url: "/api/notebooks", headers: { cookie } })).statusCode,
    ).toBe(401);
    await app.close();
  });
});
