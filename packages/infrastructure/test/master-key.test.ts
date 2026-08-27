import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMasterKey } from "../src/security/master-key.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("master key loading", () => {
  it("prefers a valid Base64 environment key without touching the key file", async () => {
    const directory = await temporaryDirectory();
    const expected = Buffer.alloc(32, 7);

    await expect(
      loadMasterKey({ dataDirectory: directory, environmentValue: expected.toString("base64") }),
    ).resolves.toEqual(expected);
    await expect(access(join(directory, "master.key"))).rejects.toThrow();
  });

  it("atomically generates a restricted key file and reuses it across concurrent starts", async () => {
    const directory = await temporaryDirectory();

    const keys = await Promise.all(
      Array.from({ length: 6 }, () => loadMasterKey({ dataDirectory: directory })),
    );
    expect(keys.every((key) => Buffer.from(key).equals(Buffer.from(keys[0] ?? [])))).toBe(true);
    expect(keys[0]).toHaveLength(32);

    const keyPath = join(directory, "master.key");
    const persisted = (await readFile(keyPath, "utf8")).trim();
    expect(Buffer.from(persisted, "base64")).toEqual(keys[0]);
    if (process.platform !== "win32") {
      expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
    }
    await expect(loadMasterKey({ dataDirectory: directory })).resolves.toEqual(keys[0]);
  });

  it("rejects malformed environment and persisted keys instead of rotating silently", async () => {
    const directory = await temporaryDirectory();

    await expect(
      loadMasterKey({ dataDirectory: directory, environmentValue: "not-a-32-byte-key" }),
    ).rejects.toThrow("32-byte Base64");

    await loadMasterKey({ dataDirectory: directory });
    const keyPath = join(directory, "master.key");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(keyPath, "corrupt", "utf8");
    await expect(loadMasterKey({ dataDirectory: directory })).rejects.toThrow("32-byte Base64");
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "cangshu-master-key-"));
  directories.push(directory);
  return directory;
}
