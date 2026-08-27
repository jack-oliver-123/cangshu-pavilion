import { defineCapability, definePlugin, noConfig, startApplication } from "@cangshu/plugin-kernel";
import { describe, expect, it } from "vitest";
import { SOURCE_INGESTION, type SourceIngestion } from "../src/capabilities.js";
import type { Notebook, Source } from "../src/domain.js";
import { sourceIngestionPlugin } from "../src/modules/source-ingestion.js";
import type {
  ModelProviderResolver,
  NotebookRepository,
  SourceBlobReferenceCoordinator,
  SourceBlobStore,
  SourceExtractor,
  SourceJobQueue,
  SourceRepository,
} from "../src/ports.js";

describe("SourceIngestion blob reference coordination", () => {
  it("does not delete bytes claimed by a concurrent import", async () => {
    const notebooks = new Map<string, Notebook>([
      ["deleting", notebook("deleting")],
      ["importing", notebook("importing")],
    ]);
    const records: Source[] = [];
    let sequence = 0;
    let blobExists = false;
    let releaseDelete: () => void = () => undefined;
    const deletionMayContinue = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    let signalDeleteStarted: () => void = () => undefined;
    const deleteStarted = new Promise<void>((resolve) => {
      signalDeleteStarted = resolve;
    });
    const notebookRepository = {
      find: async (id: string) => notebooks.get(id),
    } as unknown as NotebookRepository;
    const sourceRepository = {
      find: async (notebookId: string, sourceId: string) =>
        records.find((source) => source.notebookId === notebookId && source.id === sourceId),
      findByContentHash: async (notebookId: string, contentHash: string) =>
        records.find(
          (source) => source.notebookId === notebookId && source.contentHash === contentHash,
        ),
      create: async (input: Parameters<SourceRepository["create"]>[0]) => {
        const source: Source = {
          ...input,
          id: `source-${++sequence}`,
          status: "queued",
          passageCount: 0,
          createdAt: "2026-08-27T00:00:00.000Z",
          updatedAt: "2026-08-27T00:00:00.000Z",
        };
        records.push(source);
        return source;
      },
      delete: async (notebookId: string, sourceId: string) => {
        const index = records.findIndex(
          (source) => source.notebookId === notebookId && source.id === sourceId,
        );
        if (index < 0) return { deleted: false } as const;
        const [deleted] = records.splice(index, 1);
        const storageKey = deleted?.storageKey;
        const referenced = records.some((source) => source.storageKey === storageKey);
        return storageKey && !referenced
          ? ({ deleted: true, unreferencedStorageKey: storageKey } as const)
          : ({ deleted: true } as const);
      },
    } as unknown as SourceRepository;
    const blobs: SourceBlobStore = {
      async put(bytes) {
        blobExists = true;
        return {
          storageKey: "sha256/shared",
          contentHash: "shared",
          sizeBytes: bytes.byteLength,
        };
      },
      async read() {
        if (!blobExists) throw new Error("Blob is missing.");
        return new Uint8Array();
      },
      async deleteIfExists() {
        signalDeleteStarted();
        await deletionMayContinue;
        blobExists = false;
      },
    };
    const jobs: SourceJobQueue = { enqueue: async () => undefined };
    const extractor = {} as SourceExtractor;
    const models = {} as ModelProviderResolver;
    const blobReferences = new InMemoryReferenceCoordinator();
    let service: SourceIngestion | undefined;
    const capture = definePlugin({
      id: "capture-source-ingestion",
      provides: defineCapability<{ ready: true }>("test.capture-source-ingestion"),
      requires: { source: SOURCE_INGESTION },
      config: noConfig,
      setup({ dependencies }) {
        service = dependencies.source;
        return { ready: true as const };
      },
    });
    const application = await startApplication({
      plugins: [
        sourceIngestionPlugin({
          notebooks: notebookRepository,
          sources: sourceRepository,
          blobs,
          blobReferences,
          jobs,
          extractor,
          models,
        }),
        capture,
      ],
    });
    if (!service) throw new Error("SourceIngestion was not captured.");

    const original = await service.importText({
      notebookId: "deleting",
      title: "Original",
      text: "Shared evidence",
    });
    const deletion = service.delete("deleting", original.id);
    await deleteStarted;
    const concurrentImport = service.importText({
      notebookId: "importing",
      title: "Concurrent copy",
      text: "Shared evidence",
    });
    await Promise.race([
      concurrentImport.then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 20)),
    ]);
    releaseDelete();
    await Promise.all([deletion, concurrentImport]);

    expect(blobExists).toBe(true);
    await application.stop();
  });
});

class InMemoryReferenceCoordinator implements SourceBlobReferenceCoordinator {
  private readonly tails = new Map<string, Promise<void>>();

  async withLocks<T>(lockIds: readonly string[], operation: () => Promise<T>): Promise<T> {
    const releases: (() => void)[] = [];
    for (const lockId of [...new Set(lockIds)].sort()) {
      const previous = this.tails.get(lockId) ?? Promise.resolve();
      let release: () => void = () => undefined;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      this.tails.set(
        lockId,
        previous.then(() => current),
      );
      await previous;
      releases.push(release);
    }
    try {
      return await operation();
    } finally {
      for (const release of releases.reverse()) release();
    }
  }
}

function notebook(id: string): Notebook {
  return {
    id,
    name: id,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  };
}
