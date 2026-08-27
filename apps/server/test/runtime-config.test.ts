import { describe, expect, it } from "vitest";
import { isLoopbackHost, parseServerRuntimeConfig } from "../src/runtime-config.js";

describe("Server runtime configuration", () => {
  it("defaults to a login-free loopback deployment", () => {
    expect(parseServerRuntimeConfig({})).toEqual({
      host: "127.0.0.1",
      port: 4100,
      remoteMode: false,
      databaseUrl: "postgres://cangshu:cangshu@localhost:5432/cangshu",
      dataDirectory: expect.any(String),
    });
  });

  it.each(["localhost", "127.0.0.1", "127.42.0.9", "::1", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1"])(
    "recognizes loopback host %s",
    (host) => expect(isLoopbackHost(host)).toBe(true),
  );

  it.each(["0.0.0.0", "::", "192.168.1.20", "10.0.0.2", "research.example.com"])(
    "rejects unsafe remote bind %s before listening",
    (host) => {
      expect(() => parseServerRuntimeConfig({ CANGSHU_HOST: host })).toThrowError(
        expect.objectContaining({ code: "REMOTE_ACCESS_REQUIRES_PASSWORD" }),
      );
    },
  );

  it("accepts a protected remote bind and validates numeric settings", () => {
    expect(
      parseServerRuntimeConfig({
        CANGSHU_HOST: "0.0.0.0",
        CANGSHU_PORT: "8080",
        CANGSHU_SHARED_PASSWORD: "a-long-shared-password",
        DATABASE_URL: "postgres://example/app",
        CANGSHU_DATA_DIR: "./custom-data",
      }),
    ).toMatchObject({
      host: "0.0.0.0",
      port: 8080,
      remoteMode: true,
      sharedPassword: "a-long-shared-password",
      databaseUrl: "postgres://example/app",
    });
    expect(() => parseServerRuntimeConfig({ CANGSHU_PORT: "70000" })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });
});
