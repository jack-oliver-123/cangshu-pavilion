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

describe("SourceIngestion size limits", () => {
  it("accepts uploaded text up to 50 MiB but limits pasted text to 5 MiB of UTF-8", async () => {
    const put = vi.fn(async (bytes: Uint8Array) => ({
      storageKey: "sha256/upload",
      contentHash: `hash-${bytes.byteLength}`,
      sizeBytes: bytes.byteLength,
    }));
    let sequence = 0;
    const sources = {
      findByContentHash: vi.fn(async () => undefined),
      create: vi.fn(async (input: Parameters<SourceRepository["create"]>[0]) =>
        source(`source-${++sequence}`, input),
      ),
    } as unknown as SourceRepository;
    const notebooks = {
      find: vi.fn(async () => ({ id: "notebook-1" })),
    } as unknown as NotebookRepository;
    const blobs = { put } as unknown as SourceBlobStore;
    const blobReferences: SourceBlobReferenceCoordinator = {
      withLocks: async (_lockIds, operation) => operation(),
    };
    const jobs: SourceJobQueue = { enqueue: async () => undefined };
    let service: SourceIngestion | undefined;
    const capture = definePlugin({
      id: "capture-source-limits",
      provides: defineCapability<{ ready: true }>("test.capture-source-limits"),
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
          notebooks,
          sources,
          blobs,
          blobReferences,
          jobs,
          extractor: {} as SourceExtractor,
          models: {} as ModelProviderResolver,
        }),
        capture,
      ],
    });
    if (!service) throw new Error("SourceIngestion was not captured.");

    await expect(
      service.importBytes({
        notebookId: "notebook-1",
        title: "Six MiB upload",
        kind: "text",
        mimeType: "text/plain",
        bytes: new Uint8Array(6 * 1024 * 1024),
      }),
    ).resolves.toMatchObject({ status: "queued", sizeBytes: 6 * 1024 * 1024 });

    put.mockClear();
    await expect(
      service.importText({
        notebookId: "notebook-1",
        title: "UTF-8 paste",
        text: "藏".repeat(2 * 1024 * 1024),
      }),
    ).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE", status: 413 });
    expect(put).not.toHaveBeenCalled();
    await application.stop();
  });
});

function source(id: string, input: Parameters<SourceRepository["create"]>[0]): Source {
  return {
    ...input,
    id,
    status: "queued",
    passageCount: 0,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  };
}
