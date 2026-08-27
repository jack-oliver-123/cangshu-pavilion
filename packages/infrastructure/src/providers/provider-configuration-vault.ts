import {
  ApplicationError,
  type ProviderConfigurationInput,
  type ProviderConfigurationVault,
  type ProviderKind,
  type PublicProviderConfiguration,
} from "@cangshu/application";
import { eq } from "drizzle-orm";
import type { CangshuDatabase } from "../database/client.js";
import { providerConfigurations } from "../database/schema.js";
import type { AesGcmSecretBox } from "../security/secret-box.js";

export interface ResolvedProviderConfiguration {
  readonly kind: ProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
}

export interface ProviderConnectionTester {
  test(configuration: ResolvedProviderConfiguration): Promise<void>;
}

export interface ProviderVaultOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly tester: ProviderConnectionTester;
}

const providerKinds: readonly ProviderKind[] = ["chat", "embedding"];

export class PostgresProviderConfigurationVault implements ProviderConfigurationVault {
  private readonly environment: Readonly<Record<string, string | undefined>>;

  constructor(
    private readonly db: CangshuDatabase,
    private readonly secretBox: AesGcmSecretBox,
    private readonly options: ProviderVaultOptions,
  ) {
    this.environment = options.environment ?? process.env;
  }

  async list(): Promise<readonly PublicProviderConfiguration[]> {
    return Promise.all(providerKinds.map((kind) => this.project(kind)));
  }

  async save(input: ProviderConfigurationInput): Promise<PublicProviderConfiguration> {
    const normalized = normalizeInput(input);
    const [existing] = await this.db
      .select()
      .from(providerConfigurations)
      .where(eq(providerConfigurations.kind, normalized.kind))
      .limit(1);
    const encryptedApiKey =
      normalized.apiKey !== undefined
        ? this.secretBox.encrypt(normalized.apiKey)
        : (existing?.encryptedApiKey ?? this.secretBox.encrypt(""));
    const timestamp = new Date().toISOString();
    await this.db
      .insert(providerConfigurations)
      .values({
        kind: normalized.kind,
        baseUrl: normalized.baseUrl,
        model: normalized.model,
        encryptedApiKey,
        updatedAt: timestamp,
      })
      .onConflictDoUpdate({
        target: providerConfigurations.kind,
        set: {
          baseUrl: normalized.baseUrl,
          model: normalized.model,
          encryptedApiKey,
          updatedAt: timestamp,
        },
      });
    return this.project(normalized.kind);
  }

  async test(input: ProviderConfigurationInput): Promise<void> {
    const normalized = normalizeInput(input);
    let apiKey = normalized.apiKey;
    if (apiKey === undefined) {
      try {
        apiKey = (await this.resolve(normalized.kind)).apiKey;
      } catch (error) {
        if (!(error instanceof ApplicationError && error.code === "PROVIDER_NOT_CONFIGURED")) {
          throw error;
        }
        apiKey = "";
      }
    }
    await this.options.tester.test({
      kind: normalized.kind,
      baseUrl: normalized.baseUrl,
      model: normalized.model,
      apiKey,
    });
  }

  async resolve(
    kind: ProviderKind,
  ): Promise<Readonly<{ baseUrl: string; model: string; apiKey: string }>> {
    const environment = this.environmentConfiguration(kind);
    if (environment) {
      return {
        baseUrl: environment.baseUrl,
        model: environment.model,
        apiKey: environment.apiKey,
      };
    }
    const database = await this.databaseConfiguration(kind);
    if (!database) {
      throw new ApplicationError({
        code: "PROVIDER_NOT_CONFIGURED",
        message: `${kind === "chat" ? "Chat" : "Embedding"} Provider is not configured.`,
        status: 409,
        details: { kind },
      });
    }
    return { baseUrl: database.baseUrl, model: database.model, apiKey: database.apiKey };
  }

  private async project(kind: ProviderKind): Promise<PublicProviderConfiguration> {
    const environment = this.environmentConfiguration(kind);
    if (environment) {
      return {
        kind,
        baseUrl: environment.baseUrl,
        model: environment.model,
        hasApiKey: environment.apiKey.length > 0,
        source: "environment",
      };
    }
    const database = await this.databaseConfiguration(kind);
    if (database) {
      return {
        kind,
        baseUrl: database.baseUrl,
        model: database.model,
        hasApiKey: database.apiKey.length > 0,
        source: "database",
      };
    }
    return { kind, baseUrl: "", model: "", hasApiKey: false, source: "missing" };
  }

  private async databaseConfiguration(
    kind: ProviderKind,
  ): Promise<ResolvedProviderConfiguration | undefined> {
    const [row] = await this.db
      .select()
      .from(providerConfigurations)
      .where(eq(providerConfigurations.kind, kind))
      .limit(1);
    return row
      ? {
          kind,
          baseUrl: row.baseUrl,
          model: row.model,
          apiKey: this.secretBox.decrypt(row.encryptedApiKey),
        }
      : undefined;
  }

  private environmentConfiguration(kind: ProviderKind): ResolvedProviderConfiguration | undefined {
    const prefix = kind === "chat" ? "CANGSHU_CHAT" : "CANGSHU_EMBEDDING";
    const baseUrl = this.environment[`${prefix}_BASE_URL`]?.trim() ?? "";
    const model = this.environment[`${prefix}_MODEL`]?.trim() ?? "";
    if (baseUrl.length === 0 || model.length === 0) {
      return undefined;
    }
    return normalizeResolved({
      kind,
      baseUrl,
      model,
      apiKey: this.environment[`${prefix}_API_KEY`] ?? "",
    });
  }
}

function normalizeInput(input: ProviderConfigurationInput): ProviderConfigurationInput {
  const resolved = normalizeResolved({
    kind: input.kind,
    baseUrl: input.baseUrl,
    model: input.model,
    apiKey: input.apiKey ?? "",
  });
  return {
    kind: resolved.kind,
    baseUrl: resolved.baseUrl,
    model: resolved.model,
    ...(input.apiKey === undefined ? {} : { apiKey: resolved.apiKey }),
  };
}

function normalizeResolved(input: ResolvedProviderConfiguration): ResolvedProviderConfiguration {
  const baseUrl = input.baseUrl.trim();
  const model = input.model.trim();
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw validation("Provider baseUrl must be an absolute HTTP or HTTPS URL.");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw validation("Provider baseUrl must be an HTTP or HTTPS URL without credentials.");
  }
  if (model.length === 0 || model.length > 240) {
    throw validation("Provider model must contain 1 through 240 characters.");
  }
  return {
    kind: input.kind,
    baseUrl: url.toString().replace(/\/$/, ""),
    model,
    apiKey: input.apiKey,
  };
}

function validation(message: string): ApplicationError {
  return new ApplicationError({ code: "VALIDATION_ERROR", message, status: 400 });
}
