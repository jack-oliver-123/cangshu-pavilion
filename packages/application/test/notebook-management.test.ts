import { defineCapability, definePlugin, noConfig, startApplication } from "@cangshu/plugin-kernel";
import { describe, expect, it, vi } from "vitest";
import { NOTEBOOK_MANAGEMENT, type NotebookManagement } from "../src/capabilities.js";
import { notebookManagementPlugin } from "../src/modules/notebook-management.js";
import type {
  NotebookRepository,
  SourceBlobReferenceCoordinator,
  SourceBlobStore,
} from "../src/ports.js";

const notebook = {
  id: "notebook-1",
  name: "Research",
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

describe("NotebookManagement", () => {
  it("validates names and waits for reference-safe blob cleanup decisions", async () => {
    const create = vi.fn(async (name: string) => ({ ...notebook, name }));
    const rename = vi.fn(async (_id: string, name: string) => ({ ...notebook, name }));
    const remove = vi.fn(async () => ["sha256/aa/final-a", "sha256/bb/final-b"]);
    const notebooks = {
      list: vi.fn(async () => [notebook]),
      find: vi.fn(async () => notebook),
      create,
      rename,
      listStorageKeys: vi.fn(async () => ["sha256/aa/final-a", "sha256/bb/final-b"]),
      delete: remove,
    } satisfies NotebookRepository;
    const releases: (() => void)[] = [];
    const deleteIfExists = vi.fn(
      async (_key: string) => new Promise<void>((resolve) => releases.push(resolve)),
    );
    const blobs = { deleteIfExists } as unknown as SourceBlobStore;
    const blobReferences: SourceBlobReferenceCoordinator = {
      withLocks: async (_lockIds, operation) => operation(),
    };
    let management: NotebookManagement | undefined;
    const capture = definePlugin({
      id: "capture-notebook-management",
      provides: defineCapability<{ ready: true }>("test.capture-notebook-management"),
      requires: { notebooks: NOTEBOOK_MANAGEMENT },
      config: noConfig,
      setup({ dependencies }) {
        management = dependencies.notebooks;
        return { ready: true as const };
      },
    });
    const application = await startApplication({
      plugins: [notebookManagementPlugin({ notebooks, blobs, blobReferences }), capture],
    });

    await management?.create("  Trimmed name  ");
    await management?.rename(notebook.id, "  Renamed  ");
    expect(create).toHaveBeenCalledWith("Trimmed name");
    expect(rename).toHaveBeenCalledWith(notebook.id, "Renamed");
    expect(() => management?.create("   ")).toThrow();
    expect(create).toHaveBeenCalledTimes(1);

    let completed = false;
    const deletion = management?.delete(notebook.id).then(() => {
      completed = true;
    });
    await vi.waitFor(() => expect(deleteIfExists).toHaveBeenCalledTimes(2));
    expect(completed).toBe(false);
    for (const release of releases) release();
    await deletion;
    expect(remove).toHaveBeenCalledWith(notebook.id);
    expect(deleteIfExists.mock.calls.map(([key]) => key)).toEqual([
      "sha256/aa/final-a",
      "sha256/bb/final-b",
    ]);

    await application.stop();
  });
});
