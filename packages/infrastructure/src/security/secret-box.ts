import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

interface SecretEnvelopeV1 {
  readonly v: 1;
  readonly n: string;
  readonly c: string;
  readonly t: string;
}

const ALGORITHM = "aes-256-gcm";
const AUTHENTICATED_CONTEXT = Buffer.from("cangshu-provider-key:v1", "utf8");

export class SecretDecryptionError extends Error {
  constructor() {
    super("Provider key could not be decrypted.");
    this.name = "SecretDecryptionError";
  }
}

export class AesGcmSecretBox {
  private readonly key: Buffer;

  constructor(masterKey: Uint8Array) {
    if (masterKey.byteLength !== 32) {
      throw new TypeError("AES-256-GCM master key must be exactly 32 bytes.");
    }
    this.key = Buffer.from(masterKey);
  }

  encrypt(plaintext: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, nonce, { authTagLength: 16 });
    cipher.setAAD(AUTHENTICATED_CONTEXT);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const envelope: SecretEnvelopeV1 = {
      v: 1,
      n: nonce.toString("base64url"),
      c: ciphertext.toString("base64url"),
      t: cipher.getAuthTag().toString("base64url"),
    };
    return JSON.stringify(envelope);
  }

  decrypt(serialized: string): string {
    try {
      const envelope = parseEnvelope(serialized);
      const nonce = decodeCanonicalBase64Url(envelope.n);
      const ciphertext = decodeCanonicalBase64Url(envelope.c);
      const tag = decodeCanonicalBase64Url(envelope.t);
      if (nonce.byteLength !== 12 || tag.byteLength !== 16) {
        throw new Error("Invalid AES-GCM envelope lengths.");
      }
      const decipher = createDecipheriv(ALGORITHM, this.key, nonce, { authTagLength: 16 });
      decipher.setAAD(AUTHENTICATED_CONTEXT);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    } catch {
      throw new SecretDecryptionError();
    }
  }
}

function parseEnvelope(serialized: string): SecretEnvelopeV1 {
  const value: unknown = JSON.parse(serialized);
  if (
    typeof value !== "object" ||
    value === null ||
    !("v" in value) ||
    value.v !== 1 ||
    !("n" in value) ||
    typeof value.n !== "string" ||
    !("c" in value) ||
    typeof value.c !== "string" ||
    !("t" in value) ||
    typeof value.t !== "string"
  ) {
    throw new Error("Invalid secret envelope.");
  }
  return { v: 1, n: value.n, c: value.c, t: value.t };
}

function decodeCanonicalBase64Url(value: string): Buffer {
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new Error("Invalid Base64URL encoding.");
  }
  return decoded;
}
