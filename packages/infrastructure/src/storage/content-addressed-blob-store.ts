import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SourceBlobStore, StoredBlob } from "@cangshu/application";

const storageKeyPattern = /^sha256\/([a-f0-9]{2})\/([a-f0-9]{64})$/;

export class ContentAddressedBlobStore implements SourceBlobStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(bytes: Uint8Array): Promise<StoredBlob> {
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const prefix = contentHash.slice(0, 2);
    const storageKey = `sha256/${prefix}/${contentHash}`;
    const directory = join(this.root, "sha256", prefix);
    const target = join(directory, contentHash);
    const temporary = join(directory, `.${contentHash}.${randomUUID()}.tmp`);
    await mkdir(directory, { recursive: true });

    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await link(temporary, target);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) {
        throw error;
      }
    } finally {
      await rm(temporary, { force: true });
    }

    return { storageKey, contentHash, sizeBytes: bytes.byteLength };
  }

  async read(storageKey: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.pathFor(storageKey)));
  }

  async deleteIfExists(storageKey: string): Promise<void> {
    await rm(this.pathFor(storageKey), { force: true });
  }

  private pathFor(storageKey: string): string {
    const match = storageKeyPattern.exec(storageKey);
    const prefix = match?.[1];
    const contentHash = match?.[2];
    if (!prefix || !contentHash || prefix !== contentHash.slice(0, 2)) {
      throw new Error("Invalid content-addressed storage key.");
    }
    return join(this.root, "sha256", prefix, contentHash);
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
