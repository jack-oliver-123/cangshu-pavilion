import { makeWorkerUtils } from "graphile-worker";
import { migrateDatabase } from "./migrate.js";

export async function bootstrapDatabase(databaseUrl: string): Promise<void> {
  await migrateDatabase(databaseUrl);
  const worker = await makeWorkerUtils({ connectionString: databaseUrl, maxPoolSize: 2 });
  try {
    await worker.migrate();
  } finally {
    await worker.release();
  }
}
