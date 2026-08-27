import { defineCapability, definePlugin, noConfig, startApplication } from "@cangshu/plugin-kernel";
import { describe, expect, it, vi } from "vitest";
import {
  PROVIDER_SETTINGS,
  type ProviderSettingsManagement,
  SOURCE_INGESTION,
  type SourceIngestion,
} from "../src/capabilities.js";
import { providerSettingsPlugin } from "../src/modules/provider-settings.js";
import type { ProviderConfigurationVault } from "../src/ports.js";

describe("ProviderSettingsManagement", () => {
  it("exposes connection testing without implicitly saving configuration", async () => {
    const test = vi.fn(async () => undefined);
    const save = vi.fn();
    const vault = {
      test,
      save,
      list: vi.fn(async () => []),
      resolve: vi.fn(),
    } as unknown as ProviderConfigurationVault;
    let settings: ProviderSettingsManagement | undefined;
    const capture = definePlugin({
      id: "capture-provider-settings",
      provides: defineCapability<{ ready: true }>("test.capture-provider-settings"),
      requires: { settings: PROVIDER_SETTINGS },
      config: noConfig,
      setup({ dependencies }) {
        settings = dependencies.settings;
        return { ready: true as const };
      },
    });
    const application = await startApplication({
      plugins: [sourcePlugin(), providerSettingsPlugin(vault), capture],
    });
    const input = {
      kind: "chat" as const,
      baseUrl: "https://models.example/v1",
      model: "chat-model",
      apiKey: "candidate-key",
    };

    await settings?.test(input);

    expect(test).toHaveBeenCalledWith(input);
    expect(save).not.toHaveBeenCalled();
    await application.stop();
  });

  it("reindexes ready Sources when the effective Embedding endpoint or model changes", async () => {
    const previous = {
      kind: "embedding" as const,
      baseUrl: "https://models.example/v1",
      model: "embedding-old",
      hasApiKey: true,
      source: "database" as const,
    };
    const saved = { ...previous, model: "embedding-new" };
    const vault = {
      list: vi.fn(async () => [previous]),
      save: vi.fn(async () => saved),
      test: vi.fn(),
      resolve: vi.fn(),
    } as unknown as ProviderConfigurationVault;
    const reindexReady = vi.fn(async () => 3);
    let settings: ProviderSettingsManagement | undefined;
    const capture = definePlugin({
      id: "capture-provider-reindex",
      provides: defineCapability<{ ready: true }>("test.capture-provider-reindex"),
      requires: { settings: PROVIDER_SETTINGS },
      config: noConfig,
      setup({ dependencies }) {
        settings = dependencies.settings;
        return { ready: true as const };
      },
    });
    const application = await startApplication({
      plugins: [sourcePlugin(reindexReady), providerSettingsPlugin(vault), capture],
    });

    await settings?.save({
      kind: "embedding",
      baseUrl: saved.baseUrl,
      model: saved.model,
    });

    expect(reindexReady).toHaveBeenCalledOnce();
    await application.stop();
  });

  it("does not reindex when an Embedding save only changes the key", async () => {
    const effective = {
      kind: "embedding" as const,
      baseUrl: "https://models.example/v1",
      model: "embedding-model",
      hasApiKey: true,
      source: "database" as const,
    };
    const vault = {
      list: vi.fn(async () => [effective]),
      save: vi.fn(async () => effective),
      test: vi.fn(),
      resolve: vi.fn(),
    } as unknown as ProviderConfigurationVault;
    const reindexReady = vi.fn(async () => 1);
    let settings: ProviderSettingsManagement | undefined;
    const capture = definePlugin({
      id: "capture-provider-key-update",
      provides: defineCapability<{ ready: true }>("test.capture-provider-key-update"),
      requires: { settings: PROVIDER_SETTINGS },
      config: noConfig,
      setup({ dependencies }) {
        settings = dependencies.settings;
        return { ready: true as const };
      },
    });
    const application = await startApplication({
      plugins: [sourcePlugin(reindexReady), providerSettingsPlugin(vault), capture],
    });

    await settings?.save({
      kind: "embedding",
      baseUrl: effective.baseUrl,
      model: effective.model,
      apiKey: "replacement-key",
    });

    expect(reindexReady).not.toHaveBeenCalled();
    await application.stop();
  });
});

function sourcePlugin(reindexReady = vi.fn(async () => 0)) {
  return definePlugin({
    id: "source-ingestion-test-double",
    provides: SOURCE_INGESTION,
    requires: {},
    config: noConfig,
    setup: () => ({ reindexReady }) as unknown as SourceIngestion,
  });
}
