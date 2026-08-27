import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api.js";
import { detectAuthentication } from "../src/auth.js";

describe("authentication discovery", () => {
  it("distinguishes local mode, an authenticated session, and a required login", async () => {
    await expect(
      detectAuthentication({ get: async () => ({ authenticated: true }) }),
    ).resolves.toBe("authenticated");
    await expect(
      detectAuthentication({
        get: async () => {
          throw new ApiError("NOT_FOUND", "missing", 404);
        },
      }),
    ).resolves.toBe("local");
    await expect(
      detectAuthentication({
        get: async () => {
          throw new ApiError("UNAUTHORIZED", "login", 401);
        },
      }),
    ).resolves.toBe("required");
  });

  it("does not hide transport or unexpected server failures", async () => {
    const failure = new ApiError("INTERNAL_ERROR", "failed", 500);
    await expect(
      detectAuthentication({
        get: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
  });
});
