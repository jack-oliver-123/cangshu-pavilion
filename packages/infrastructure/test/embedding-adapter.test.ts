import { describe, expect, it, vi } from "vitest";
import {
  type EmbeddingApiClient,
  type EmbeddingApiResponse,
  OpenAiCompatibleEmbeddingAdapter,
} from "../src/providers/openai-compatible-embedding.js";

class ScriptedEmbeddingClient implements EmbeddingApiClient {
  readonly requests: { model: string; input: readonly string[]; signal: AbortSignal }[] = [];

  constructor(
    private readonly respond: (
      input: readonly string[],
      signal: AbortSignal,
    ) => Promise<EmbeddingApiResponse>,
  ) {}

  async create(input: {
    model: string;
    input: readonly string[];
    signal: AbortSignal;
  }): Promise<EmbeddingApiResponse> {
    this.requests.push(input);
    return this.respond(input.input, input.signal);
  }
}

describe("OpenAI-compatible Embedding Adapter", () => {
  it("batches inputs, restores response order, and exposes a key-free model fingerprint", async () => {
    const client = new ScriptedEmbeddingClient(async (input) => ({
      data: input.map((text, index) => ({ index, embedding: [text.length, 1] })).reverse(),
    }));
    const adapter = new OpenAiCompatibleEmbeddingAdapter({
      baseUrl: "https://models.example/v1",
      model: "embed-v1",
      apiKey: "private-key",
      client,
      maxBatchSize: 64,
    });
    const input = Array.from({ length: 130 }, (_, index) => `text-${index}`);

    const embeddings = await adapter.embed(input);

    expect(client.requests.map((request) => request.input.length)).toEqual([64, 64, 2]);
    expect(embeddings).toHaveLength(130);
    expect(embeddings[0]).toEqual([6, 1]);
    expect(adapter.modelKey).toMatch(/^openai-compatible:embed-v1:[a-f0-9]{16}$/);
    expect(adapter.modelKey).not.toContain("private-key");
  });

  it.each([
    { data: [{ index: 0, embedding: [] }] },
    { data: [{ index: 0, embedding: [Number.NaN] }] },
    { data: [{ index: 1, embedding: [1] }] },
  ])("rejects malformed vectors", async (response) => {
    const client = new ScriptedEmbeddingClient(async () => response);
    const adapter = new OpenAiCompatibleEmbeddingAdapter({
      baseUrl: "https://models.example/v1",
      model: "embed-v1",
      apiKey: "secret",
      client,
    });

    await expect(adapter.embed(["input"])).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });

  it("bounds request time and redacts verbose Provider failures", async () => {
    vi.useFakeTimers();
    try {
      const client = new ScriptedEmbeddingClient(
        (_input, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () =>
              reject(new Error("Authorization: Bearer private-key; response=secret-body")),
            );
          }),
      );
      const adapter = new OpenAiCompatibleEmbeddingAdapter({
        baseUrl: "https://models.example/v1",
        model: "embed-v1",
        apiKey: "private-key",
        client,
        timeoutMs: 500,
      });

      const result = adapter.embed(["input"]).catch((error) => error);
      await vi.advanceTimersByTimeAsync(500);
      const error = await result;
      expect(error).toMatchObject({ code: "PROVIDER_ERROR" });
      expect(JSON.stringify(error)).not.toContain("private-key");
      expect(JSON.stringify(error)).not.toContain("secret-body");
    } finally {
      vi.useRealTimers();
    }
  });
});
