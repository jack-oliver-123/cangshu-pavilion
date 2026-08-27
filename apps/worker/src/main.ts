import { resolve } from "node:path";
import { sourceIngestionPlugin } from "@cangshu/application";
import { createRuntimeResources, workerHostPlugin } from "@cangshu/infrastructure";
import { type RunningApplication, startApplication } from "@cangshu/plugin-kernel";

const databaseUrl =
  process.env.DATABASE_URL?.trim() || "postgres://cangshu:cangshu@localhost:5432/cangshu";
const dataDirectory = resolve(process.cwd(), process.env.CANGSHU_DATA_DIR?.trim() || "./data");
const resources = await createRuntimeResources({
  databaseUrl,
  dataDirectory,
  environment: process.env,
});
let application: RunningApplication | undefined;

try {
  application = await startApplication({
    plugins: [
      sourceIngestionPlugin({
        notebooks: resources.notebooks,
        sources: resources.sources,
        blobs: resources.blobs,
        blobReferences: resources.blobReferences,
        jobs: resources.jobs,
        extractor: resources.extractors,
        models: resources.models,
      }),
      workerHostPlugin({
        pool: resources.database.pool,
        logSink: { write: (record) => console.log(JSON.stringify(record)) },
      }),
    ],
  });
} catch (error) {
  await resources.close();
  throw error;
}

console.log(JSON.stringify({ event: "worker.ready", concurrency: 2 }));

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
