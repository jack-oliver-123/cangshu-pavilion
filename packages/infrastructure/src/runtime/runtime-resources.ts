import { join } from "node:path";
import { connectDatabase, type DatabaseConnection } from "../database/client.js";
import {
  PostgresConversationRepository,
  PostgresNotebookRepository,
  PostgresNoteRepository,
  PostgresSourceRepository,
} from "../database/repositories.js";
import { PostgresSourceBlobReferenceCoordinator } from "../database/source-blob-reference-coordinator.js";
import { PdfSourceExtractor } from "../extraction/pdf-source-extractor.js";
import { SafeWebPageFetcher } from "../extraction/safe-web-fetcher.js";
import { SourceExtractorRouter } from "../extraction/source-extractor-router.js";
import { TextSourceExtractor } from "../extraction/text-source-extractor.js";
import { WebSourceExtractor } from "../extraction/web-source-extractor.js";
import { PostgresProviderConfigurationVault } from "../providers/provider-configuration-vault.js";
import {
  MinimalProviderConnectionTester,
  VaultModelProviderResolver,
} from "../providers/provider-runtime.js";
import { GraphileSourceJobQueue } from "../queue/graphile-source-job-queue.js";
import { loadMasterKey } from "../security/master-key.js";
import { AesGcmSecretBox } from "../security/secret-box.js";
import { ContentAddressedBlobStore } from "../storage/content-addressed-blob-store.js";

export interface RuntimeResourcesOptions {
  readonly databaseUrl: string;
  readonly dataDirectory: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export interface RuntimeResources {
  readonly database: DatabaseConnection;
  readonly notebooks: PostgresNotebookRepository;
  readonly sources: PostgresSourceRepository;
  readonly blobReferences: PostgresSourceBlobReferenceCoordinator;
  readonly conversations: PostgresConversationRepository;
  readonly notes: PostgresNoteRepository;
  readonly blobs: ContentAddressedBlobStore;
  readonly jobs: GraphileSourceJobQueue;
  readonly extractors: SourceExtractorRouter;
  readonly vault: PostgresProviderConfigurationVault;
  readonly models: VaultModelProviderResolver;
  close(): Promise<void>;
}

export async function createRuntimeResources(
  options: RuntimeResourcesOptions,
): Promise<RuntimeResources> {
  const database = connectDatabase(options.databaseUrl);
  let jobs: GraphileSourceJobQueue | undefined;
  try {
    const blobs = new ContentAddressedBlobStore(join(options.dataDirectory, "blobs"));
    const masterKey = await loadMasterKey({
      dataDirectory: options.dataDirectory,
      ...(options.environment?.CANGSHU_MASTER_KEY
        ? { environmentValue: options.environment.CANGSHU_MASTER_KEY }
        : {}),
    });
    const vault = new PostgresProviderConfigurationVault(
      database.db,
      new AesGcmSecretBox(masterKey),
      {
        ...(options.environment ? { environment: options.environment } : {}),
        tester: new MinimalProviderConnectionTester(),
      },
    );
    const models = new VaultModelProviderResolver(vault);
    jobs = await GraphileSourceJobQueue.create(database.pool);
    const extractors = new SourceExtractorRouter({
      pdf: new PdfSourceExtractor(blobs),
      web: new WebSourceExtractor(new SafeWebPageFetcher()),
      text: new TextSourceExtractor(blobs),
    });
    let closed = false;

    return {
      database,
      notebooks: new PostgresNotebookRepository(database.db),
      sources: new PostgresSourceRepository(database.db),
      blobReferences: new PostgresSourceBlobReferenceCoordinator(database.pool),
      conversations: new PostgresConversationRepository(database.db),
      notes: new PostgresNoteRepository(database.db),
      blobs,
      jobs,
      extractors,
      vault,
      models,
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        await jobs?.close();
        await database.close();
      },
    };
  } catch (error) {
    await jobs?.close();
    await database.close();
    throw error;
  }
}
