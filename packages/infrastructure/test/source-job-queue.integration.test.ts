import { runTaskListOnce } from "graphile-worker";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { GraphileSourceJobQueue } from "../src/queue/graphile-source-job-queue.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("Graphile Source job queue", () => {
  if (!databaseUrl) {
    return;
  }

  it("migrates, deduplicates by Source, survives reconnect, and bounds attempts", async () => {
    const databaseName = "cangshu_queue_test";
    const adminUrl = new URL(databaseUrl);
    adminUrl.pathname = "/postgres";
    const targetUrl = new URL(databaseUrl);
    targetUrl.pathname = `/${databaseName}`;
    const admin = new Pool({ connectionString: adminUrl.toString() });

    await admin.query(`drop database if exists "${databaseName}" with (force)`);
    await admin.query(`create database "${databaseName}"`);
    try {
      const producerPool = new Pool({ connectionString: targetUrl.toString() });
      const queue = await GraphileSourceJobQueue.create(producerPool, { maxAttempts: 4 });
      await queue.enqueue({ notebookId: "notebook-a", sourceId: "source-a" });
      await queue.enqueue({ notebookId: "notebook-a", sourceId: "source-a" });

      const jobs = await producerPool.query<{
        key: string;
        task_identifier: string;
        max_attempts: number;
      }>("select key, task_identifier, max_attempts from graphile_worker.jobs");
      expect(jobs.rows).toEqual([
        { key: "source:source-a", task_identifier: "process_source", max_attempts: 4 },
      ]);
      await queue.close();
      await producerPool.end();

      const consumerPool = new Pool({ connectionString: targetUrl.toString() });
      const client = await consumerPool.connect();
      const received: unknown[] = [];
      try {
        const worker = runTaskListOnce(
          { noHandleSignals: true },
          { process_source: async (payload) => void received.push(payload) },
          client,
        );
        await worker.promise;
      } finally {
        client.release();
        await consumerPool.end();
      }
      expect(received).toEqual([{ notebookId: "notebook-a", sourceId: "source-a" }]);
    } finally {
      await admin.query(`drop database if exists "${databaseName}" with (force)`);
      await admin.end();
    }
  });
});
