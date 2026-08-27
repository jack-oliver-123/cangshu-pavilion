import type {
  ChatModel,
  EmbeddingModel,
  ModelProviderResolver,
  ProviderConfigurationVault,
} from "@cangshu/application";
import { OpenAiCompatibleChatAdapter } from "./openai-compatible-chat.js";
import { OpenAiCompatibleEmbeddingAdapter } from "./openai-compatible-embedding.js";
import type {
  ProviderConnectionTester,
  ResolvedProviderConfiguration,
} from "./provider-configuration-vault.js";

export interface ProviderModelFactory {
  embedding(configuration: ResolvedProviderConfiguration): EmbeddingModel;
  chat(configuration: ResolvedProviderConfiguration): ChatModel;
}

export class OpenAiCompatibleModelFactory implements ProviderModelFactory {
  embedding(configuration: ResolvedProviderConfiguration): EmbeddingModel {
    return new OpenAiCompatibleEmbeddingAdapter(configuration);
  }

  chat(configuration: ResolvedProviderConfiguration): ChatModel {
    return new OpenAiCompatibleChatAdapter(configuration);
  }
}

export class MinimalProviderConnectionTester implements ProviderConnectionTester {
  constructor(
    private readonly factory: ProviderModelFactory = new OpenAiCompatibleModelFactory(),
  ) {}

  async test(configuration: ResolvedProviderConfiguration): Promise<void> {
    if (configuration.kind === "embedding") {
      await this.factory.embedding(configuration).embed(["connection test"]);
      return;
    }
    const chat = this.factory.chat(configuration);
    for await (const _event of chat.stream({
      question: "connection test",
      history: [],
      passages: [
        {
          label: "P1",
          passageId: "connection-test",
          sourceTitle: "Connection test",
          locator: "connection test",
          content: "connection test",
        },
      ],
    })) {
      // Fully consume the stream so authentication and streaming errors surface.
    }
  }
}

export class VaultModelProviderResolver implements ModelProviderResolver {
  constructor(
    private readonly vault: ProviderConfigurationVault,
    private readonly factory: ProviderModelFactory = new OpenAiCompatibleModelFactory(),
  ) {}

  async embedding(): Promise<EmbeddingModel> {
    const configuration = await this.vault.resolve("embedding");
    return this.factory.embedding({ kind: "embedding", ...configuration });
  }

  async chat(): Promise<ChatModel> {
    const configuration = await this.vault.resolve("chat");
    return this.factory.chat({ kind: "chat", ...configuration });
  }
}
