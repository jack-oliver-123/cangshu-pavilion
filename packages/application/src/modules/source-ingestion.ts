import { definePlugin, noConfig } from "@cangshu/plugin-kernel";
import { z } from "zod";
import { SOURCE_INGESTION, type SourceIngestion } from "../capabilities.js";
import type {
  ExtractedBlock,
  PreparedPassage,
  Source,
  SourceFailure,
  SourceLocator,
} from "../domain.js";
import { ApplicationError, notFound } from "../errors.js";
import type {
  ModelProviderResolver,
  NotebookRepository,
  SourceBlobReferenceCoordinator,
  SourceBlobStore,
  SourceExtractor,
  SourceJobQueue,
  SourceRepository,
} from "../ports.js";

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_PASSAGE_CHARACTERS = 1_600;
const PASSAGE_OVERLAP = 160;
const titleSchema = z.string().trim().min(1).max(240);
const urlSchema = z.url({ protocol: /^https?$/ });

export function sourceIngestionPlugin(input: {
  notebooks: NotebookRepository;
  sources: SourceRepository;
  blobs: SourceBlobStore;
  blobReferences: SourceBlobReferenceCoordinator;
  jobs: SourceJobQueue;
  extractor: SourceExtractor;
  models: ModelProviderResolver;
}) {
  return definePlugin({
    id: "source-ingestion",
    provides: SOURCE_INGESTION,
    requires: {},
    config: noConfig,
    setup(): SourceIngestion {
      const enqueueOrFail = async (notebookId: string, sourceId: string): Promise<void> => {
        try {
          await input.jobs.enqueue({ notebookId, sourceId });
        } catch (error) {
          await input.sources.fail(notebookId, sourceId, {
            stage: "import",
            code: "QUEUE_UNAVAILABLE",
            message: "Source processing could not be queued.",
            retryable: true,
          });
          throw new ApplicationError({
            code: "INTERNAL_ERROR",
            message: "Source processing could not be queued.",
            status: 503,
            cause: error,
          });
        }
      };

      const ensureNotebook = async (notebookId: string): Promise<void> => {
        if (!(await input.notebooks.find(notebookId))) {
          throw notFound("Notebook", notebookId);
        }
      };

      const importBytes: SourceIngestion["importBytes"] = async (request) => {
        await ensureNotebook(request.notebookId);
        if (request.bytes.byteLength > MAX_SOURCE_BYTES) {
          throw new ApplicationError({
            code: "SOURCE_TOO_LARGE",
            message: `Source exceeds the ${Math.floor(MAX_SOURCE_BYTES / 1024 / 1024)} MiB limit.`,
            status: 413,
          });
        }
        const title = titleSchema.parse(request.title);
        const stored = await input.blobs.put(request.bytes);
        return input.blobReferences.withLocks(
          [notebookLockId(request.notebookId), blobLockId(stored.storageKey)],
          async () => {
            await ensureNotebook(request.notebookId);
            await input.blobs.put(request.bytes);
            const existing = await input.sources.findByContentHash(
              request.notebookId,
              stored.contentHash,
            );
            if (existing) {
              return existing;
            }
            let source: Source;
            try {
              source = await input.sources.create({
                notebookId: request.notebookId,
                title,
                kind: request.kind,
                mimeType: request.mimeType,
                storageKey: stored.storageKey,
                contentHash: stored.contentHash,
                sizeBytes: stored.sizeBytes,
              });
            } catch (error) {
              const racedDuplicate = await input.sources.findByContentHash(
                request.notebookId,
                stored.contentHash,
              );
              if (racedDuplicate) {
                return racedDuplicate;
              }
              throw error;
            }
            await enqueueOrFail(source.notebookId, source.id);
            return source;
          },
        );
      };

      return {
        list: (notebookId) => input.sources.list(notebookId),
        async get(notebookId, sourceId) {
          const source = await input.sources.find(notebookId, sourceId);
          if (!source) {
            throw notFound("Source", sourceId);
          }
          return source;
        },
        importBytes,
        async importText(request) {
          const bytes = new TextEncoder().encode(request.text);
          if (bytes.byteLength > MAX_TEXT_BYTES) {
            throw new ApplicationError({
              code: "SOURCE_TOO_LARGE",
              message: `Pasted text exceeds the ${Math.floor(MAX_TEXT_BYTES / 1024 / 1024)} MiB limit.`,
              status: 413,
            });
          }
          return importBytes({
            notebookId: request.notebookId,
            title: request.title,
            kind: request.kind ?? "text",
            mimeType: request.kind === "markdown" ? "text/markdown" : "text/plain",
            bytes,
          });
        },
        async importUrl(request) {
          await ensureNotebook(request.notebookId);
          const url = urlSchema.parse(request.url).toString();
          const source = await input.sources.create({
            notebookId: request.notebookId,
            title: titleSchema.parse(request.title ?? new URL(url).hostname),
            kind: "web",
            mimeType: "text/html",
            originalUrl: url,
          });
          await enqueueOrFail(source.notebookId, source.id);
          return source;
        },
        async retry(notebookId, sourceId) {
          const existing = await input.sources.find(notebookId, sourceId);
          if (!existing) {
            throw notFound("Source", sourceId);
          }
          if (existing.status !== "failed" || existing.failure?.retryable !== true) {
            throw new ApplicationError({
              code: "CONFLICT",
              message: "This Source cannot be retried.",
              status: 409,
            });
          }
          const source = await input.sources.markQueued(notebookId, sourceId);
          if (!source) throw notFound("Source", sourceId);
          await enqueueOrFail(notebookId, sourceId);
          return source;
        },
        async reconcileStale(request) {
          const before = new Date(request.before);
          if (
            Number.isNaN(before.valueOf()) ||
            !Number.isInteger(request.limit) ||
            request.limit < 1 ||
            request.limit > 1_000
          ) {
            throw new ApplicationError({
              code: "VALIDATION_ERROR",
              message: "The reconciliation boundary or limit is invalid.",
              status: 400,
            });
          }
          const staleSources = await input.sources.listStale({
            before: before.toISOString(),
            limit: request.limit,
          });
          let requeued = 0;
          for (const stale of staleSources) {
            const claimed = await input.sources.requeueStale({
              notebookId: stale.notebookId,
              sourceId: stale.id,
              before: before.toISOString(),
            });
            if (!claimed) {
              continue;
            }
            await enqueueOrFail(stale.notebookId, stale.id);
            requeued += 1;
          }
          return requeued;
        },
        async reindexReady() {
          const readySources = await input.sources.listReady();
          let requeued = 0;
          for (const ready of readySources) {
            const source = await input.sources.markQueued(ready.notebookId, ready.id);
            if (!source) {
              continue;
            }
            await enqueueOrFail(source.notebookId, source.id);
            requeued += 1;
          }
          return requeued;
        },
        async delete(notebookId, sourceId) {
          await input.blobReferences.withLocks([notebookLockId(notebookId)], async () => {
            const source = await input.sources.find(notebookId, sourceId);
            if (!source) {
              throw notFound("Source", sourceId);
            }
            await input.blobReferences.withLocks(
              source.storageKey ? [blobLockId(source.storageKey)] : [],
              async () => {
                const result = await input.sources.delete(notebookId, sourceId);
                if (!result.deleted) {
                  throw notFound("Source", sourceId);
                }
                if (result.unreferencedStorageKey) {
                  await input.blobs.deleteIfExists(result.unreferencedStorageKey);
                }
              },
            );
          });
        },
        async process(notebookId, sourceId) {
          const source = await input.sources.find(notebookId, sourceId);
          if (!source) {
            throw notFound("Source", sourceId);
          }
          if (source.status === "ready") {
            return;
          }

          let stage: SourceFailure["stage"] = "extract";
          try {
            await input.sources.markStatus(notebookId, sourceId, "extracting");
            const blocks = await input.extractor.extract(source);
            if (blocks.length === 0 || blocks.every((block) => block.content.trim().length === 0)) {
              throw new ApplicationError({
                code: "SOURCE_TYPE_UNSUPPORTED",
                message: "No readable text was found in this Source.",
                status: 422,
              });
            }

            stage = "embed";
            await input.sources.markStatus(notebookId, sourceId, "indexing");
            const model = await input.models.embedding();
            const drafts = splitIntoPassages(blocks);
            const prepared: PreparedPassage[] = [];
            for (let offset = 0; offset < drafts.length; offset += 32) {
              const batch = drafts.slice(offset, offset + 32);
              const embeddings = await model.embed(batch.map((passage) => passage.content));
              if (embeddings.length !== batch.length) {
                throw new Error("Embedding Provider returned an unexpected vector count.");
              }
              for (let index = 0; index < batch.length; index += 1) {
                const draft = batch[index];
                const embedding = embeddings[index];
                if (!draft || !embedding || embedding.length === 0) {
                  throw new Error("Embedding Provider returned an empty vector.");
                }
                prepared.push({ ...draft, embedding, embeddingModel: model.modelKey });
              }
            }

            stage = "persist";
            await input.sources.complete(notebookId, sourceId, prepared);
          } catch (error) {
            const failure = sourceFailure(stage, error);
            await input.sources.fail(notebookId, sourceId, failure);
            throw error;
          }
        },
      };
    },
  });
}

function notebookLockId(notebookId: string): string {
  return `0:notebook:${notebookId}`;
}

function blobLockId(storageKey: string): string {
  return `1:blob:${storageKey}`;
}

interface PassageDraft extends Omit<PreparedPassage, "embedding" | "embeddingModel"> {}

export function splitIntoPassages(blocks: readonly ExtractedBlock[]): readonly PassageDraft[] {
  const passages: PassageDraft[] = [];
  for (const block of blocks) {
    const content = block.content;
    let start = 0;
    while (start < content.length) {
      let end = Math.min(content.length, start + MAX_PASSAGE_CHARACTERS);
      if (end < content.length) {
        const breakAt = Math.max(content.lastIndexOf("\n", end), content.lastIndexOf(" ", end));
        if (breakAt > start + MAX_PASSAGE_CHARACTERS / 2) {
          end = breakAt;
        }
      }
      const candidate = content.slice(start, end);
      const leadingWhitespace = candidate.match(/^\s*/u)?.[0].length ?? 0;
      const trailingWhitespace = candidate.match(/\s*$/u)?.[0].length ?? 0;
      const characterStart = start + leadingWhitespace;
      const characterEnd = end - trailingWhitespace;
      if (characterStart < characterEnd) {
        const passageContent = content.slice(characterStart, characterEnd);
        passages.push({
          ordinal: passages.length,
          content: passageContent,
          locator: withCharacterRange(block, characterStart, characterEnd),
          tokenEstimate: Math.ceil(passageContent.length / 4),
        });
      }
      if (end >= content.length) {
        break;
      }
      start = Math.max(start + 1, end - PASSAGE_OVERLAP);
    }
  }
  return passages;
}

function withCharacterRange(block: ExtractedBlock, start: number, end: number): SourceLocator {
  return { ...block.locator, characterStart: start, characterEnd: end } as SourceLocator;
}

function sourceFailure(stage: SourceFailure["stage"], error: unknown): SourceFailure {
  const message =
    error instanceof ApplicationError
      ? error.message.slice(0, 500)
      : {
          import: "Source import failed.",
          extract: "Source extraction failed.",
          embed: "Source embedding failed.",
          persist: "Source persistence failed.",
        }[stage];
  return {
    stage,
    code: error instanceof ApplicationError ? error.code : "SOURCE_PROCESSING_FAILED",
    message,
    retryable: !(error instanceof ApplicationError && error.status >= 400 && error.status < 500),
  };
}
