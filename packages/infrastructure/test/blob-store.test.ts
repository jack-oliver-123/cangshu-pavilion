import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentAddressedBlobStore } from "../src/storage/content-addressed-blob-store.js";

describe("content-addressed Source blob storage", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("atomically reuses bytes by SHA-256 and only accepts canonical storage keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "cangshu-blob-test-"));
    roots.push(root);
    const store = new ContentAddressedBlobStore(root);
    const bytes = new TextEncoder().encode("hello");
    const expectedHash = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

    const stored = await Promise.all(Array.from({ length: 8 }, () => store.put(bytes)));
    expect(stored).toEqual(
      Array.from({ length: 8 }, () => ({
        storageKey: `sha256/2c/${expectedHash}`,
        contentHash: expectedHash,
        sizeBytes: 5,
      })),
    );
    await expect(store.read(stored[0]?.storageKey ?? "")).resolves.toEqual(bytes);
    await expect(store.read("../../outside")).rejects.toThrow(/storage key/i);

    await store.deleteIfExists(stored[0]?.storageKey ?? "");
    await store.deleteIfExists(stored[0]?.storageKey ?? "");
    await expect(store.read(stored[0]?.storageKey ?? "")).rejects.toThrow();
  });
});
