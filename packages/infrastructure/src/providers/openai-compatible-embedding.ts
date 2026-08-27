import { createHash } from "node:crypto";
import { ApplicationError, type EmbeddingModel } from "@cangshu/application";
import OpenAI from "openai";

export interface EmbeddingApiResponse {
  readonly data: readonly Readonly<{ index: number; embedding: readonly number[] }>[];
}

export interface EmbeddingApiClient {
  create(input: {
    model: string;
    input: readonly string[];
    signal: AbortSignal;
  }): Promise<EmbeddingApiResponse>;
}

export interface OpenAiCompatibleEmbeddingOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
  readonly client?: EmbeddingApiClient;
  readonly maxBatchSize?: number;
  readonly timeoutMs?: number;
}

export class OpenAiCompatibleEmbeddingAdapter implements EmbeddingModel {
  readonly modelKey: string;
  private readonly client: EmbeddingApiClient;
  private readonly maxBatchSize: number;
  private readonly timeoutMs: number;

  constructor(private readonly options: OpenAiCompatibleEmbeddingOptions) {
    this.maxBatchSize = boundedInteger(options.maxBatchSize ?? 64, 1, 2_048, "maxBatchSize");
    this.timeoutMs = boundedInteger(options.timeoutMs ?? 30_000, 1, 300_000, "timeoutMs");
    this.client =
      options.client ??
      new OpenAiSdkEmbeddingClient({
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
      });
    const fingerprint = createHash("sha256")
      .update(`${options.baseUrl}\0${options.model}`)
      .digest("hex")
      .slice(0, 16);
    this.modelKey = `openai-compatible:${options.model}:${fingerprint}`;
  }

  async embed(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) {
      return [];
    }
    const result: (readonly number[])[] = [];
    let expectedDimension: number | undefined;
    for (let offset = 0; offset < texts.length; offset += this.maxBatchSize) {
      const batch = texts.slice(offset, offset + this.maxBatchSize);
      const response = await this.requestBatch(batch);
      if (response.data.length !== batch.length) {
        throw providerError();
      }
      const ordered = [...response.data].sort((left, right) => left.index - right.index);
      for (let index = 0; index < ordered.length; index += 1) {
        const item = ordered[index];
        if (
          !item ||
          item.index !== index ||
          item.embedding.length === 0 ||
          item.embedding.some((value) => !Number.isFinite(value))
        ) {
          throw providerError();
        }
        expectedDimension ??= item.embedding.length;
        if (item.embedding.length !== expectedDimension) {
          throw providerError();
        }
        result.push([...item.embedding]);
      }
    }
    return result;
  }

  private async requestBatch(batch: readonly string[]): Promise<EmbeddingApiResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.client.create({
        model: this.options.model,
        input: batch,
        signal: controller.signal,
      });
    } catch {
      throw providerError();
    } finally {
      clearTimeout(timer);
    }
  }
}

export class OpenAiSdkEmbeddingClient implements EmbeddingApiClient {
  private readonly client: OpenAI;

  constructor(input: { baseUrl: string; apiKey: string }) {
    this.client = new OpenAI({
      baseURL: input.baseUrl,
      apiKey: input.apiKey || "not-required",
      maxRetries: 1,
    });
  }

  async create(input: {
    model: string;
    input: readonly string[];
    signal: AbortSignal;
  }): Promise<EmbeddingApiResponse> {
    const response = await this.client.embeddings.create(
      { model: input.model, input: [...input.input], encoding_format: "float" },
      { signal: input.signal },
    );
    return {
      data: response.data.map((item) => ({ index: item.index, embedding: item.embedding })),
    };
  }
}

function providerError(): ApplicationError {
  return new ApplicationError({
    code: "PROVIDER_ERROR",
    message: "Embedding Provider request failed or returned invalid vectors.",
    status: 502,
    details: { kind: "embedding" },
  });
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}
