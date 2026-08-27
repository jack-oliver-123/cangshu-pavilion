import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectDatabase } from "../src/database/client.js";
import { migrateDatabase } from "../src/database/migrate.js";
import {
  PostgresProviderConfigurationVault,
  type ProviderConnectionTester,
} from "../src/providers/provider-configuration-vault.js";
import { AesGcmSecretBox } from "../src/security/secret-box.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("ProviderConfigurationVault", () => {
  if (!databaseUrl) {
    return;
  }

  const databaseName = "cangshu_provider_vault_test";
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";
  const targetUrl = new URL(databaseUrl);
  targetUrl.pathname = `/${databaseName}`;
  const admin = new Pool({ connectionString: adminUrl.toString() });
  let connection: ReturnType<typeof connectDatabase>;
  const secretBox = new AesGcmSecretBox(Buffer.alloc(32, 9));
  const testConnection = vi.fn(async () => undefined);
  const tester: ProviderConnectionTester = { test: testConnection };

  beforeAll(async () => {
    await admin.query(`drop database if exists "${databaseName}" with (force)`);
    await admin.query(`create database "${databaseName}"`);
    await migrateDatabase(targetUrl.toString());
    connection = connectDatabase(targetUrl.toString());
  });

  beforeEach(async () => {
    await connection.pool.query("truncate table provider_configurations");
    testConnection.mockClear();
  });

  afterAll(async () => {
    await connection.close();
    await admin.query(`drop database if exists "${databaseName}" with (force)`);
    await admin.end();
  });

  it("stores kinds independently, preserves omitted keys, and never projects plaintext", async () => {
    const vault = new PostgresProviderConfigurationVault(connection.db, secretBox, {
      environment: {},
      tester,
    });
    await expect(vault.list()).resolves.toEqual([
      { kind: "chat", baseUrl: "", model: "", hasApiKey: false, source: "missing" },
      { kind: "embedding", baseUrl: "", model: "", hasApiKey: false, source: "missing" },
    ]);

    await vault.save({
      kind: "chat",
      baseUrl: "https://chat.example.test/v1",
      model: "chat-model",
      apiKey: "sk-chat-plaintext",
    });
    await vault.save({
      kind: "embedding",
      baseUrl: "https://embed.example.test/v1",
      model: "embed-model",
      apiKey: "sk-embed-plaintext",
    });
    const rows = await connection.pool.query<{ kind: string; encrypted_api_key: string }>(
      "select kind, encrypted_api_key from provider_configurations order by kind",
    );
    expect(rows.rows).toHaveLength(2);
    expect(JSON.stringify(rows.rows)).not.toContain("sk-chat-plaintext");
    expect(JSON.stringify(rows.rows)).not.toContain("sk-embed-plaintext");

    await vault.save({
      kind: "chat",
      baseUrl: "https://chat-2.example.test/v1",
      model: "chat-model-2",
    });
    await expect(vault.resolve("chat")).resolves.toEqual({
      baseUrl: "https://chat-2.example.test/v1",
      model: "chat-model-2",
      apiKey: "sk-chat-plaintext",
    });
    await expect(vault.resolve("embedding")).resolves.toEqual({
      baseUrl: "https://embed.example.test/v1",
      model: "embed-model",
      apiKey: "sk-embed-plaintext",
    });
    expect(await vault.list()).toEqual([
      {
        kind: "chat",
        baseUrl: "https://chat-2.example.test/v1",
        model: "chat-model-2",
        hasApiKey: true,
        source: "database",
      },
      {
        kind: "embedding",
        baseUrl: "https://embed.example.test/v1",
        model: "embed-model",
        hasApiKey: true,
        source: "database",
      },
    ]);
  });

  it("uses only complete environment groups as per-kind overrides", async () => {
    const baseVault = new PostgresProviderConfigurationVault(connection.db, secretBox, {
      environment: {},
      tester,
    });
    await baseVault.save({
      kind: "chat",
      baseUrl: "https://database.example/v1",
      model: "database-chat",
      apiKey: "database-key",
    });
    await baseVault.save({
      kind: "embedding",
      baseUrl: "https://database.example/v1",
      model: "database-embedding",
    });

    const overridden = new PostgresProviderConfigurationVault(connection.db, secretBox, {
      environment: {
        CANGSHU_CHAT_BASE_URL: "https://environment.example/v1",
        CANGSHU_CHAT_MODEL: "environment-chat",
        CANGSHU_CHAT_API_KEY: "environment-key",
        CANGSHU_EMBEDDING_BASE_URL: "https://partial.example/v1",
      },
      tester,
    });
    await expect(overridden.resolve("chat")).resolves.toEqual({
      baseUrl: "https://environment.example/v1",
      model: "environment-chat",
      apiKey: "environment-key",
    });
    expect(await overridden.list()).toEqual([
      {
        kind: "chat",
        baseUrl: "https://environment.example/v1",
        model: "environment-chat",
        hasApiKey: true,
        source: "environment",
      },
      {
        kind: "embedding",
        baseUrl: "https://database.example/v1",
        model: "database-embedding",
        hasApiKey: false,
        source: "database",
      },
    ]);
  });

  it("tests submitted settings without persisting them", async () => {
    const vault = new PostgresProviderConfigurationVault(connection.db, secretBox, {
      environment: {},
      tester,
    });
    await vault.test({
      kind: "embedding",
      baseUrl: "https://candidate.example/v1",
      model: "candidate-model",
      apiKey: "candidate-key",
    });

    expect(testConnection).toHaveBeenCalledWith({
      kind: "embedding",
      baseUrl: "https://candidate.example/v1",
      model: "candidate-model",
      apiKey: "candidate-key",
    });
    const count = await connection.pool.query<{ count: string }>(
      "select count(*)::text as count from provider_configurations",
    );
    expect(count.rows[0]?.count).toBe("0");
  });
});
