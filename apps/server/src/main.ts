import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  notebookManagementPlugin,
  noteManagementPlugin,
  providerSettingsPlugin,
  researchAnsweringPlugin,
  sourceIngestionPlugin,
} from "@cangshu/application";
import { createRuntimeResources } from "@cangshu/infrastructure";
import { type RunningApplication, startApplication } from "@cangshu/plugin-kernel";
import { httpHostPlugin } from "./http/http-host-plugin.js";
import { parseServerRuntimeConfig } from "./runtime-config.js";

const config = parseServerRuntimeConfig(process.env);
const resources = await createRuntimeResources({
  databaseUrl: config.databaseUrl,
  dataDirectory: config.dataDirectory,
  environment: process.env,
});
let application: RunningApplication | undefined;

try {
  const staticCandidate = fileURLToPath(new URL("../../web/dist", import.meta.url));
  const staticRoot = existsSync(join(staticCandidate, "index.html")) ? staticCandidate : undefined;
  application = await startApplication({
    plugins: [
      notebookManagementPlugin({
        notebooks: resources.notebooks,
        blobs: resources.blobs,
        blobReferences: resources.blobReferences,
      }),
      sourceIngestionPlugin({
        notebooks: resources.notebooks,
        sources: resources.sources,
        blobs: resources.blobs,
        blobReferences: resources.blobReferences,
        jobs: resources.jobs,
        extractor: resources.extractors,
        models: resources.models,
      }),
      researchAnsweringPlugin({
        conversations: resources.conversations,
        sources: resources.sources,
        models: resources.models,
      }),
      noteManagementPlugin({
        notes: resources.notes,
        conversations: resources.conversations,
      }),
      providerSettingsPlugin(resources.vault),
      httpHostPlugin({
        host: config.host,
        port: config.port,
        ...(staticRoot ? { staticRoot } : {}),
        ...(config.remoteMode && config.sharedPassword
          ? { remoteAuth: { sharedPassword: config.sharedPassword } }
          : {}),
        logSink: { write: (record) => console.log(JSON.stringify(record)) },
      }),
    ],
  });
} catch (error) {
  await resources.close();
  throw error;
}

console.log(JSON.stringify({ event: "server.ready", host: config.host, port: config.port }));

let stopping: Promise<void> | undefined;
const stop = (): Promise<void> => {
  stopping ??= (async () => {
    await application?.stop();
    await resources.close();
  })();
  return stopping;
};
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
