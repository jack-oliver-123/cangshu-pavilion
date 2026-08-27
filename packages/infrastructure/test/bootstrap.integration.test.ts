import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { bootstrapDatabase } from "../src/database/bootstrap.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("database bootstrap", () => {
  if (!databaseUrl) {
    return;
  }

  it("creates application and Worker schemas from empty and is repeatable", async () => {
    const targetName = "cangshu_bootstrap_test";
    const adminUrl = new URL(databaseUrl);
    adminUrl.pathname = "/postgres";
    const targetUrl = new URL(databaseUrl);
    targetUrl.pathname = `/${targetName}`;
    const admin = new Pool({ connectionString: adminUrl.toString() });

    await admin.query(`drop database if exists "${targetName}" with (force)`);
    await admin.query(`create database "${targetName}"`);
    try {
      await bootstrapDatabase(targetUrl.toString());
      await bootstrapDatabase(targetUrl.toString());

      const target = new Pool({ connectionString: targetUrl.toString() });
      try {
        const applicationTable = await target.query<{ present: string | null }>(
          "select to_regclass('public.notebooks')::text as present",
        );
        const workerTable = await target.query<{ present: string | null }>(
          "select to_regclass('graphile_worker.jobs')::text as present",
        );
        expect(applicationTable.rows[0]?.present).toBe("notebooks");
        expect(workerTable.rows[0]?.present).toBe("graphile_worker.jobs");
      } finally {
        await target.end();
      }
    } finally {
      await admin.query(`drop database if exists "${targetName}" with (force)`);
      await admin.end();
    }
  });
});
