import type { ChatModel, EmbeddingModel, ProviderConfigurationVault } from "@cangshu/application";
import { describe, expect, it, vi } from "vitest";
import {
  MinimalProviderConnectionTester,
  type ProviderModelFactory,
  VaultModelProviderResolver,
} from "../src/providers/provider-runtime.js";

describe("Provider runtime", () => {
  it("tests each kind with a minimal real model operation", async () => {
    const embed = vi.fn(async () => [[1, 0]]);
    const chatInput: unknown[] = [];
    const embedding: EmbeddingModel = { modelKey: "test", embed };
    const chat: ChatModel = {
      async *stream(input) {
        chatInput.push(input);
        yield { type: "delta", delta: "Connected [P1]" };
        yield { type: "completed", content: "Connected [P1]", citedLabels: ["P1"] };
      },
    };
    const factory: ProviderModelFactory = {
      embedding: vi.fn(() => embedding),
      chat: vi.fn(() => chat),
    };
    const tester = new MinimalProviderConnectionTester(factory);

    await tester.test({
      kind: "embedding",
      baseUrl: "https://models.example/v1",
      model: "embed",
      apiKey: "key",
    });
    await tester.test({
      kind: "chat",
      baseUrl: "https://models.example/v1",
      model: "chat",
      apiKey: "key",
    });

    expect(embed).toHaveBeenCalledWith(["connection test"]);
    expect(chatInput).toEqual([
      expect.objectContaining({
        question: "connection test",
        history: [],
        passages: [expect.objectContaining({ label: "P1", content: "connection test" })],
      }),
    ]);
  });

  it("resolves current Vault configuration for every model acquisition", async () => {
    const resolve = vi.fn(async (kind: "chat" | "embedding") => ({
      baseUrl: `https://${kind}.example/v1`,
      model: `${kind}-model`,
      apiKey: `${kind}-key`,
    }));
    const vault = { resolve } as unknown as ProviderConfigurationVault;
    const embedding = { modelKey: "dynamic", embed: vi.fn() } as unknown as EmbeddingModel;
    const chat = { stream: vi.fn() } as unknown as ChatModel;
    const factory: ProviderModelFactory = {
      embedding: vi.fn(() => embedding),
      chat: vi.fn(() => chat),
    };
    const resolver = new VaultModelProviderResolver(vault, factory);

    await expect(resolver.embedding()).resolves.toBe(embedding);
    await expect(resolver.chat()).resolves.toBe(chat);
    await expect(resolver.embedding()).resolves.toBe(embedding);
    expect(resolve.mock.calls.map(([kind]) => kind)).toEqual(["embedding", "chat", "embedding"]);
    expect(factory.embedding).toHaveBeenLastCalledWith({
      kind: "embedding",
      baseUrl: "https://embedding.example/v1",
      model: "embedding-model",
      apiKey: "embedding-key",
    });
  });
});
