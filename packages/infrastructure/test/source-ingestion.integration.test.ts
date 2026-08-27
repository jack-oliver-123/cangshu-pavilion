import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type EmbeddingModel,
  type ModelProviderResolver,
  SOURCE_INGESTION,
  type SourceIngestion,
  type SourceJobQueue,
  sourceIngestionPlugin,
} from "@cangshu/application";
import { defineCapability, definePlugin, noConfig, startApplication } from "@cangshu/plugin-kernel";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectDatabase } from "../src/database/client.js";
import { migrateDatabase } from "../src/database/migrate.js";
import {
  PostgresNotebookRepository,
  PostgresSourceRepository,
} from "../src/database/repositories.js";
import { PostgresSourceBlobReferenceCoordinator } from "../src/database/source-blob-reference-coordinator.js";
import { TextSourceExtractor } from "../src/extraction/text-source-extractor.js";
import { ContentAddressedBlobStore } from "../src/storage/content-addressed-blob-store.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

class CapturingQueue implements SourceJobQueue {
  readonly jobs: { notebookId: string; sourceId: string }[] = [];

  async enqueue(input: { notebookId: string; sourceId: string }): Promise<void> {
    this.jobs.push(input);
  }
}

describe.skipIf(!databaseUrl)("SourceIngestion with production persistence", () => {
  if (!databaseUrl) {
    return;
  }

  const databaseName = "cangshu_source_ingestion_test";
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";
  const targetUrl = new URL(databaseUrl);
  targetUrl.pathname = `/${databaseName}`;
  const admin = new Pool({ connectionString: adminUrl.toString() });
  let connection: ReturnType<typeof connectDatabase>;
  let blobDirectory = "";
  let application: Awaited<ReturnType<typeof startApplication>> | undefined;
  let service: SourceIngestion;
  let queue: CapturingQueue;
  let embed: ReturnType<typeof vi.fn<EmbeddingModel["embed"]>>;
  let notebooks: PostgresNotebookRepository;
  let sources: PostgresSourceRepository;
  let blobs: ContentAddressedBlobStore;

  beforeAll(async () => {
    await admin.query(`drop database if exists "${databaseName}" with (force)`);
    await admin.query(`create database "${databaseName}"`);
    await migrateDatabase(targetUrl.toString());
    connection = connectDatabase(targetUrl.toString());
  });

  beforeEach(async () => {
    await connection.pool.query("truncate table notebooks cascade");
    blobDirectory = await mkdtemp(join(tmpdir(), "cangshu-source-ingestion-"));
    notebooks = new PostgresNotebookRepository(connection.db);
    sources = new PostgresSourceRepository(connection.db);
    blobs = new ContentAddressedBlobStore(blobDirectory);
    queue = new CapturingQueue();
    embed = vi.fn(async (texts: readonly string[]) => {
      if (texts.some((text) => text.includes("FAIL_EMBEDDING"))) {
        throw new Error("Authorization: Bearer private-api-key; body=secret-source");
      }
      return texts.map((text) => [text.length, 1]);
    });
    const models: ModelProviderResolver = {
      embedding: async () => ({ modelKey: "test-embedding", embed }),
      chat: async () => {
        throw new Error("Chat is not used in Source tests.");
      },
    };
    const captureCapability = defineCapability<{ readonly ready: true }>("test.capture-source");
    const capturePlugin = definePlugin({
      id: "capture-source",
      provides: captureCapability,
      requires: { source: SOURCE_INGESTION },
      config: noConfig,
      setup({ dependencies }) {
        service = dependencies.source;
        return { ready: true as const };
      },
    });
    const ingestionPlugin = sourceIngestionPlugin({
      notebooks,
      sources,
      blobs,
      blobReferences: new PostgresSourceBlobReferenceCoordinator(connection.pool),
      jobs: queue,
      extractor: new TextSourceExtractor(blobs),
      models,
    });
    application = await startApplication({ plugins: [ingestionPlugin, capturePlugin] });
  });

  afterEach(async () => {
    await application?.stop();
    application = undefined;
    await rm(blobDirectory, { recursive: true, force: true });
  });

  afterAll(async () => {
    await connection.close();
    await admin.query(`drop database if exists "${databaseName}" with (force)`);
    await admin.end();
  });

  it("deduplicates concurrent imports and processes exactly one stable Passage set", async () => {
    const notebook = await notebooks.create("并发材料");
    const request = {
      notebookId: notebook.id,
      title: "重复文本",
      text: "Alpha evidence.\n\nBeta evidence.",
    };

    const imported = await Promise.all(
      Array.from({ length: 4 }, () => service.importText(request)),
    );
    expect(new Set(imported.map((source) => source.id))).toHaveLength(1);
    expect(queue.jobs).toHaveLength(1);

    const source = imported[0];
    expect(source?.storageKey).toBeDefined();
    await service.process(notebook.id, source?.id ?? "");
    expect(await service.get(notebook.id, source?.id ?? "")).toMatchObject({
      status: "ready",
      passageCount: 2,
    });
    expect(
      (await sources.listPassages(notebook.id, source?.id ?? "")).map((item) => item.ordinal),
    ).toEqual([0, 1]);
    expect(await sources.listAttempts(notebook.id, source?.id ?? "")).toMatchObject([
      { status: "completed" },
    ]);

    await service.process(notebook.id, source?.id ?? "");
    expect(embed).toHaveBeenCalledTimes(1);
    expect(await sources.listAttempts(notebook.id, source?.id ?? "")).toHaveLength(1);

    await service.delete(notebook.id, source?.id ?? "");
    await expect(blobs.read(source?.storageKey ?? "")).rejects.toThrow();
  });

  it("keeps a blob when its final-reference deletion races with an import in another Notebook", async () => {
    const deletingNotebook = await notebooks.create("删除中的材料");
    const importingNotebook = await notebooks.create("导入中的材料");
    const text = "Shared evidence must remain readable.";
    const original = await service.importText({
      notebookId: deletingNotebook.id,
      title: "Original",
      text,
    });
    const originalDelete = blobs.deleteIfExists.bind(blobs);
    let releaseDelete: () => void = () => undefined;
    const deletionMayContinue = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    let signalDeleteStarted: () => void = () => undefined;
    const deleteStarted = new Promise<void>((resolve) => {
      signalDeleteStarted = resolve;
    });
    vi.spyOn(blobs, "deleteIfExists").mockImplementation(async (storageKey) => {
      signalDeleteStarted();
      await deletionMayContinue;
      await originalDelete(storageKey);
    });

    const deletion = service.delete(deletingNotebook.id, original.id);
    await deleteStarted;
    const imported = service.importText({
      notebookId: importingNotebook.id,
      title: "Concurrent copy",
      text,
    });
    await Promise.race([
      imported.then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 100)),
    ]);
    releaseDelete();

    const [, concurrentCopy] = await Promise.all([deletion, imported]);
    await expect(blobs.read(concurrentCopy.storageKey ?? "")).resolves.toEqual(
      new TextEncoder().encode(text),
    );
  });

  it("projects redacted failures and creates a new Attempt on retry", async () => {
    const notebook = await notebooks.create("失败材料");
    const source = await service.importText({
      notebookId: notebook.id,
      title: "Provider failure",
      text: "FAIL_EMBEDDING",
    });

    await expect(service.process(notebook.id, source.id)).rejects.toThrow();
    const failed = await service.get(notebook.id, source.id);
    expect(failed).toMatchObject({
      status: "failed",
      failure: { stage: "embed", code: "SOURCE_PROCESSING_FAILED", retryable: true },
    });
    expect(JSON.stringify(failed.failure)).not.toContain("private-api-key");
    expect(JSON.stringify(failed.failure)).not.toContain("secret-source");

    await service.retry(notebook.id, source.id);
    await expect(service.process(notebook.id, source.id)).rejects.toThrow();
    expect(await sources.listAttempts(notebook.id, source.id)).toMatchObject([
      { status: "failed" },
      { status: "failed" },
    ]);
    expect(queue.jobs).toHaveLength(2);
  });

  it("projects unsupported content as non-retryable and rejects retry", async () => {
    const notebook = await notebooks.create("不支持材料");
    const source = await service.importText({
      notebookId: notebook.id,
      title: "Blank text",
      text: " \n\n  ",
    });

    await expect(service.process(notebook.id, source.id)).rejects.toMatchObject({
      code: "SOURCE_TYPE_UNSUPPORTED",
    });
    expect(await service.get(notebook.id, source.id)).toMatchObject({
      status: "failed",
      failure: {
        stage: "extract",
        code: "SOURCE_TYPE_UNSUPPORTED",
        retryable: false,
      },
    });
    await expect(service.retry(notebook.id, source.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(queue.jobs).toHaveLength(1);
  });

  it("conditionally requeues stale processing Sources and closes interrupted Attempts", async () => {
    const notebook = await notebooks.create("恢复材料");
    const stale = await service.importText({
      notebookId: notebook.id,
      title: "Stale processing",
      text: "Recoverable evidence",
    });
    const fresh = await service.importText({
      notebookId: notebook.id,
      title: "Fresh queued",
      text: "Fresh evidence",
    });
    await sources.markStatus(notebook.id, stale.id, "extracting");
    await connection.pool.query(
      "update sources set updated_at = now() - interval '1 hour' where id = $1",
      [stale.id],
    );
    queue.jobs.length = 0;

    const reconciliation = service as SourceIngestion & {
      reconcileStale(input: { before: string; limit: number }): Promise<number>;
    };
    await expect(
      reconciliation.reconcileStale({
        before: new Date(Date.now() - 10 * 60_000).toISOString(),
        limit: 100,
      }),
    ).resolves.toBe(1);

    expect(queue.jobs).toEqual([{ notebookId: notebook.id, sourceId: stale.id }]);
    expect(await service.get(notebook.id, stale.id)).toMatchObject({ status: "queued" });
    expect(await service.get(notebook.id, fresh.id)).toMatchObject({ status: "queued" });
    expect(await sources.listAttempts(notebook.id, stale.id)).toMatchObject([
      {
        status: "failed",
        failure: { code: "PROCESS_INTERRUPTED", retryable: true },
      },
    ]);

    await expect(
      reconciliation.reconcileStale({
        before: new Date(Date.now() - 10 * 60_000).toISOString(),
        limit: 100,
      }),
    ).resolves.toBe(0);
    expect(queue.jobs).toHaveLength(1);
  });
});
