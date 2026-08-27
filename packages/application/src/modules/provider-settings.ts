import { definePlugin, noConfig } from "@cangshu/plugin-kernel";
import {
  PROVIDER_SETTINGS,
  type ProviderSettingsManagement,
  SOURCE_INGESTION,
} from "../capabilities.js";
import type { PublicProviderConfiguration } from "../domain.js";
import type { ProviderConfigurationVault } from "../ports.js";

export function providerSettingsPlugin(vault: ProviderConfigurationVault) {
  return definePlugin({
    id: "provider-settings",
    provides: PROVIDER_SETTINGS,
    requires: { sources: SOURCE_INGESTION },
    config: noConfig,
    setup({ dependencies }): ProviderSettingsManagement {
      return {
        list: () => vault.list(),
        async save(input) {
          const previous = (await vault.list()).find((item) => item.kind === input.kind);
          const saved = await vault.save(input);
          if (input.kind === "embedding" && embeddingIdentityChanged(previous, saved)) {
            await dependencies.sources.reindexReady();
          }
          return saved;
        },
        test: (input) => vault.test(input),
      };
    },
  });
}

function embeddingIdentityChanged(
  previous: PublicProviderConfiguration | undefined,
  current: PublicProviderConfiguration,
): boolean {
  return previous?.baseUrl !== current.baseUrl || previous.model !== current.model;
}
