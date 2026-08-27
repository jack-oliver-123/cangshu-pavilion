import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "./client.js";

export async function migrateDatabase(databaseUrl: string): Promise<void> {
  const connection = connectDatabase(databaseUrl);
  try {
    await migrate(connection.db, {
      migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
    });
  } finally {
    await connection.close();
  }
}
