import { defineCapability, definePlugin, noConfig, startApplication } from "@cangshu/plugin-kernel";
import { describe, expect, it, vi } from "vitest";
import { SOURCE_INGESTION, type SourceIngestion } from "../src/capabilities.js";
import type { Source } from "../src/domain.js";
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

describe("SourceIngestion reindexing", () => {
  it("claims and enqueues every still-existing ready Source", async () => {
    const first = readySource("source-1", "notebook-1");
    const deleted = readySource("source-2", "notebook-2");
    const listReady = vi.fn(async () => [first, deleted]);
    const markQueued = vi.fn(async (_notebookId: string, sourceId: string) =>
      sourceId === first.id ? { ...first, status: "queued" as const } : undefined,
    );
    const enqueue = vi.fn(async () => undefined);
    const sources = { listReady, markQueued } as unknown as SourceRepository;
    const jobs: SourceJobQueue = { enqueue };
    const blobReferences: SourceBlobReferenceCoordinator = {
      withLocks: async (_lockIds, operation) => operation(),
    };
    let service: SourceIngestion | undefined;
    const capture = definePlugin({
      id: "capture-source-reindex",
      provides: defineCapability<{ ready: true }>("test.capture-source-reindex"),
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
          notebooks: {} as NotebookRepository,
          sources,
          blobs: {} as SourceBlobStore,
          blobReferences,
          jobs,
          extractor: {} as SourceExtractor,
          models: {} as ModelProviderResolver,
        }),
        capture,
      ],
    });
    if (!service) throw new Error("SourceIngestion was not captured.");

    await expect(service.reindexReady()).resolves.toBe(1);
    expect(markQueued).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith({ notebookId: first.notebookId, sourceId: first.id });
    await application.stop();
  });
});

function readySource(id: string, notebookId: string): Source {
  return {
    id,
    notebookId,
    title: id,
    kind: "text",
    status: "ready",
    mimeType: "text/plain",
    passageCount: 1,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  };
}
