import { randomBytes } from "node:crypto";
import { chmod, link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

export interface MasterKeyOptions {
  readonly dataDirectory: string;
  readonly environmentValue?: string;
}

const KEY_FILE_NAME = "master.key";

export async function loadMasterKey(options: MasterKeyOptions): Promise<Uint8Array> {
  if (options.environmentValue !== undefined && options.environmentValue.trim().length > 0) {
    return decodeMasterKey(options.environmentValue);
  }

  await mkdir(options.dataDirectory, { recursive: true });
  const keyPath = join(options.dataDirectory, KEY_FILE_NAME);
  try {
    return await readRestrictedKey(keyPath);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) {
      throw error;
    }
  }

  const generated = randomBytes(32);
  const temporaryPath = join(
    options.dataDirectory,
    `.master-key-${process.pid}-${randomBytes(8).toString("hex")}.tmp`,
  );
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${generated.toString("base64")}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    try {
      await link(temporaryPath, keyPath);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) {
        throw error;
      }
    }
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if (!hasCode(error, "ENOENT")) {
        throw error;
      }
    });
  }
  return readRestrictedKey(keyPath);
}

async function readRestrictedKey(path: string): Promise<Uint8Array> {
  await chmod(path, 0o600);
  return decodeMasterKey(await readFile(path, "utf8"));
}

function decodeMasterKey(value: string): Uint8Array {
  const normalized = value.trim();
  const decoded = Buffer.from(normalized, "base64");
  if (decoded.byteLength !== 32 || decoded.toString("base64") !== normalized) {
    throw new Error("Master key must be a canonical 32-byte Base64 value.");
  }
  return decoded;
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
