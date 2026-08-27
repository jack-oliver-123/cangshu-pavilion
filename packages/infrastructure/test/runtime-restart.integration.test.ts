import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOURCE_INGESTION, type SourceIngestion } from "@cangshu/application";
import { definePlugin, noConfig, startApplication } from "@cangshu/plugin-kernel";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "../src/database/migrate.js";
import { providerConfigurations } from "../src/database/schema.js";
import { createRuntimeResources, type RuntimeResources } from "../src/runtime/runtime-resources.js";
import { workerHostPlugin } from "../src/worker/worker-host-plugin.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("runtime restart durability", () => {
  if (!databaseUrl) return;

  it("preserves records, encrypted configuration, blobs, and queued work across restarts", async () => {
    const databaseName = "cangshu_runtime_restart_test";
    const adminUrl = new URL(databaseUrl);
    adminUrl.pathname = "/postgres";
    const targetUrl = new URL(databaseUrl);
    targetUrl.pathname = `/${databaseName}`;
    const admin = new Pool({ connectionString: adminUrl.toString() });
    const dataDirectory = await mkdtemp(join(tmpdir(), "cangshu-runtime-restart-"));
    let resources: RuntimeResources | undefined;

    await admin.query(`drop database if exists "${databaseName}" with (force)`);
    await admin.query(`create database "${databaseName}"`);
    try {
      await migrateDatabase(targetUrl.toString());
      resources = await createRuntimeResources({
        databaseUrl: targetUrl.toString(),
        dataDirectory,
        environment: {},
      });
      const notebook = await resources.notebooks.create("重启研究库");
      const stored = await resources.blobs.put(new TextEncoder().encode("重启后仍可读取的原件"));
      const source = await resources.sources.create({
        notebookId: notebook.id,
        title: "等待处理的资料",
        kind: "text",
        mimeType: "text/plain",
        ...stored,
      });
      const citedSource = await resources.sources.create({
        notebookId: notebook.id,
        title: "已引用的资料",
        kind: "text",
        mimeType: "text/plain",
      });
      await resources.sources.markStatus(notebook.id, citedSource.id, "extracting");
      await resources.sources.complete(notebook.id, citedSource.id, [
        {
          ordinal: 0,
          content: "重启不会丢失引用。",
          locator: {
            kind: "text",
            startLine: 1,
            endLine: 1,
            characterStart: 0,
            characterEnd: 10,
          },
          tokenEstimate: 6,
          embedding: [1, 0],
          embeddingModel: "embedding-model",
        },
      ]);
      const [citedPassage] = await resources.sources.listPassages(notebook.id, citedSource.id);
      if (!citedPassage) throw new Error("Cited Passage was not persisted.");
      const conversation = await resources.conversations.create(notebook.id, "重启对话");
      const message = await resources.conversations.addMessage({
        notebookId: notebook.id,
        conversationId: conversation.id,
        role: "researcher",
        status: "completed",
        content: "重启后还能看到吗？",
      });
      const pendingAnswer = await resources.conversations.addMessage({
        notebookId: notebook.id,
        conversationId: conversation.id,
        role: "assistant",
        status: "pending",
        content: "",
      });
      const answer = await resources.conversations.completeAssistantMessage({
        notebookId: notebook.id,
        conversationId: conversation.id,
        messageId: pendingAnswer.id,
        content: "会保留。[P1]",
        citations: [
          {
            passageId: citedPassage.id,
            sourceId: citedSource.id,
            sourceTitle: citedSource.title,
            label: "P1",
            locator: citedPassage.locator,
            excerpt: citedPassage.content,
          },
        ],
      });
      const note = await resources.notes.create({
        notebookId: notebook.id,
        title: "重启笔记",
        content: "持久内容",
        sourceMessageId: answer.id,
      });
      await resources.vault.save({
        kind: "embedding",
        baseUrl: "https://models.example/v1",
        model: "embedding-model",
        apiKey: "restart-private-key",
      });
      await resources.jobs.enqueue({ notebookId: notebook.id, sourceId: source.id });
      await resources.close();
      resources = undefined;

      resources = await createRuntimeResources({
        databaseUrl: targetUrl.toString(),
        dataDirectory,
        environment: {},
      });
      await expect(resources.notebooks.find(notebook.id)).resolves.toMatchObject({
        name: "重启研究库",
      });
      await expect(resources.sources.find(notebook.id, source.id)).resolves.toMatchObject({
        status: "queued",
      });
      await expect(resources.sources.find(notebook.id, citedSource.id)).resolves.toMatchObject({
        status: "ready",
        passageCount: 1,
      });
      await expect(resources.blobs.read(stored.storageKey)).resolves.toEqual(
        new TextEncoder().encode("重启后仍可读取的原件"),
      );
      const reloadedConversation = await resources.conversations.find(notebook.id, conversation.id);
      expect(reloadedConversation?.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: message.id }),
          expect.objectContaining({
            id: answer.id,
            status: "completed",
            citations: [expect.objectContaining({ label: "P1", passageId: citedPassage.id })],
          }),
        ]),
      );
      await expect(resources.notes.find(notebook.id, note.id)).resolves.toMatchObject({
        content: "持久内容",
        sourceMessageId: answer.id,
      });
      await expect(resources.vault.list()).resolves.toContainEqual(
        expect.objectContaining({
          kind: "embedding",
          model: "embedding-model",
          hasApiKey: true,
          source: "database",
        }),
      );
      const encryptedRows = await resources.database.db.select().from(providerConfigurations);
      expect(JSON.stringify(encryptedRows)).not.toContain("restart-private-key");

      const firstProcess = vi.fn(async () => undefined);
      const firstWorker = await startWorker(resources, firstProcess);
      await vi.waitFor(() => expect(firstProcess).toHaveBeenCalledWith(notebook.id, source.id), {
        timeout: 5_000,
      });
      await firstWorker.stop();

      await resources.jobs.enqueue({ notebookId: notebook.id, sourceId: source.id });
      const secondProcess = vi.fn(async () => undefined);
      const secondWorker = await startWorker(resources, secondProcess);
      await vi.waitFor(() => expect(secondProcess).toHaveBeenCalledWith(notebook.id, source.id), {
        timeout: 5_000,
      });
      await secondWorker.stop();
    } finally {
      await resources?.close();
      await admin.query(`drop database if exists "${databaseName}" with (force)`);
      await admin.end();
      await rm(dataDirectory, { recursive: true, force: true });
    }
  }, 20_000);
});

function startWorker(
  resources: RuntimeResources,
  process: (notebookId: string, sourceId: string) => Promise<void>,
) {
  const sourceIngestion = definePlugin({
    id: "restart-source-ingestion",
    provides: SOURCE_INGESTION,
    requires: {},
    config: noConfig,
    setup: () =>
      ({
        reconcileStale: async () => 0,
        process,
      }) as unknown as SourceIngestion,
  });
  return startApplication({
    plugins: [
      sourceIngestion,
      workerHostPlugin({
        pool: resources.database.pool,
        reconciliationIntervalMs: 60_000,
        logSink: { write: () => undefined },
      }),
    ],
  });
}
