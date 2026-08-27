import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export type CangshuDatabase = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  readonly pool: Pool;
  readonly db: CangshuDatabase;
  close(): Promise<void>;
}

export function connectDatabase(databaseUrl: string): DatabaseConnection {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  pool.on("error", () => {
    console.error(JSON.stringify({ event: "database.idle-client-error" }));
  });
  pool.on("connect", (client) => {
    client.on("error", () => {
      console.error(JSON.stringify({ event: "database.active-client-error" }));
    });
  });
  const db = drizzle(pool, { schema });
  return {
    pool,
    db,
    async close() {
      await pool.end();
    },
  };
}
