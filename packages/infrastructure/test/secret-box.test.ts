import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AesGcmSecretBox, SecretDecryptionError } from "../src/security/secret-box.js";

describe("AES-GCM secret box", () => {
  it("uses a random nonce and round-trips without plaintext in the envelope", () => {
    const box = new AesGcmSecretBox(randomBytes(32));
    const plaintext = "sk-sensitive-provider-key";

    const first = box.encrypt(plaintext);
    const second = box.encrypt(plaintext);

    expect(first).not.toBe(second);
    expect(first).not.toContain(plaintext);
    expect(second).not.toContain(plaintext);
    expect(box.decrypt(first)).toBe(plaintext);
    expect(box.decrypt(second)).toBe(plaintext);
    expect(JSON.parse(first)).toMatchObject({ v: 1 });
  });

  it.each(["nonce", "ciphertext", "tag"] as const)("rejects tampered %s", (field) => {
    const box = new AesGcmSecretBox(randomBytes(32));
    const envelope = JSON.parse(box.encrypt("secret")) as Record<string, unknown>;
    const property = { nonce: "n", ciphertext: "c", tag: "t" }[field];
    envelope[property] = `${String(envelope[property])}A`;

    expect(() => box.decrypt(JSON.stringify(envelope))).toThrow(SecretDecryptionError);
    expect(() => box.decrypt(JSON.stringify(envelope))).toThrow(
      "Provider key could not be decrypted.",
    );
  });

  it("rejects the wrong key, malformed data, and unsupported versions uniformly", () => {
    const encrypted = new AesGcmSecretBox(randomBytes(32)).encrypt("secret");
    const wrong = new AesGcmSecretBox(randomBytes(32));
    const future = JSON.stringify({ ...JSON.parse(encrypted), v: 2 });

    for (const value of [encrypted, "not-json", future]) {
      const target = value === encrypted ? wrong : new AesGcmSecretBox(randomBytes(32));
      expect(() => target.decrypt(value)).toThrow(SecretDecryptionError);
    }
  });

  it("requires an exact 32-byte master key", () => {
    expect(() => new AesGcmSecretBox(randomBytes(31))).toThrow("32 bytes");
  });
});
