import type { SourceJobQueue } from "@cangshu/application";
import { makeWorkerUtils, type WorkerUtils } from "graphile-worker";
import type { Pool } from "pg";

export interface GraphileSourceJobQueueOptions {
  readonly maxAttempts?: number;
}

export class GraphileSourceJobQueue implements SourceJobQueue {
  private closed = false;

  private constructor(
    private readonly workerUtils: WorkerUtils,
    private readonly maxAttempts: number,
  ) {}

  static async create(
    pool: Pool,
    options: GraphileSourceJobQueueOptions = {},
  ): Promise<GraphileSourceJobQueue> {
    const maxAttempts = options.maxAttempts ?? 5;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
      throw new TypeError("maxAttempts must be an integer from 1 through 100.");
    }

    const workerUtils = await makeWorkerUtils({ pgPool: pool });
    try {
      await workerUtils.migrate();
      return new GraphileSourceJobQueue(workerUtils, maxAttempts);
    } catch (error) {
      await workerUtils.release();
      throw error;
    }
  }

  async enqueue(input: { notebookId: string; sourceId: string }): Promise<void> {
    if (this.closed) {
      throw new Error("The Source job queue is closed.");
    }
    await this.workerUtils.addJob("process_source", input, {
      jobKey: `source:${input.sourceId}`,
      jobKeyMode: "replace",
      maxAttempts: this.maxAttempts,
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.workerUtils.release();
  }
}
