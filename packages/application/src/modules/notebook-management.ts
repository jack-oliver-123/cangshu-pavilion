import { definePlugin, noConfig } from "@cangshu/plugin-kernel";
import { z } from "zod";
import { NOTEBOOK_MANAGEMENT, type NotebookManagement } from "../capabilities.js";
import { notFound } from "../errors.js";
import type {
  NotebookRepository,
  SourceBlobReferenceCoordinator,
  SourceBlobStore,
} from "../ports.js";

const notebookName = z.string().trim().min(1).max(120);

export function notebookManagementPlugin(input: {
  notebooks: NotebookRepository;
  blobs: SourceBlobStore;
  blobReferences: SourceBlobReferenceCoordinator;
}) {
  return definePlugin({
    id: "notebook-management",
    provides: NOTEBOOK_MANAGEMENT,
    requires: {},
    config: noConfig,
    setup(): NotebookManagement {
      return {
        list: () => input.notebooks.list(),
        async get(notebookId) {
          const notebook = await input.notebooks.find(notebookId);
          if (!notebook) {
            throw notFound("Notebook", notebookId);
          }
          return notebook;
        },
        create(name) {
          return input.notebooks.create(notebookName.parse(name));
        },
        async rename(notebookId, name) {
          const notebook = await input.notebooks.rename(notebookId, notebookName.parse(name));
          if (!notebook) {
            throw notFound("Notebook", notebookId);
          }
          return notebook;
        },
        async delete(notebookId) {
          await input.blobReferences.withLocks([notebookLockId(notebookId)], async () => {
            const existing = await input.notebooks.find(notebookId);
            if (!existing) {
              throw notFound("Notebook", notebookId);
            }
            const storageKeys = await input.notebooks.listStorageKeys(notebookId);
            await input.blobReferences.withLocks(storageKeys.map(blobLockId), async () => {
              const unreferencedStorageKeys = await input.notebooks.delete(notebookId);
              await Promise.all(
                unreferencedStorageKeys.map((storageKey) => input.blobs.deleteIfExists(storageKey)),
              );
            });
          });
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
