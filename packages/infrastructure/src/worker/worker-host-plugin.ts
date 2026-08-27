import { SOURCE_INGESTION, type SourceIngestion } from "@cangshu/application";
import { defineCapability, definePlugin, noConfig } from "@cangshu/plugin-kernel";
import {
  Logger,
  type LogLevel,
  runTaskList,
  type TaskList,
  type WorkerPool,
} from "graphile-worker";
import type { Pool } from "pg";
import { z } from "zod";

export interface WorkerHost {
  readonly concurrency: number;
}

export const WORKER_HOST = defineCapability<WorkerHost>("cangshu.worker-host");

export interface WorkerLogRecord {
  readonly event: "worker.runtime";
  readonly level: LogLevel;
  readonly label?: string;
  readonly workerId?: string;
  readonly taskIdentifier?: string;
  readonly jobId?: string;
}

export interface WorkerLogSink {
  write(record: WorkerLogRecord): void;
}

export interface WorkerProcess {
  gracefulShutdown(message?: string): void | Promise<void>;
  readonly promise: Promise<void>;
}

export interface WorkerRuntimeInput {
  readonly pool: Pool;
  readonly tasks: TaskList;
  readonly logger: Logger;
  readonly concurrency: number;
  readonly noHandleSignals: boolean;
}

export interface WorkerRuntime {
  start(input: WorkerRuntimeInput): WorkerProcess;
}

export class GraphileWorkerRuntime implements WorkerRuntime {
  start(input: WorkerRuntimeInput): WorkerPool {
    return runTaskList(
      {
        concurrency: input.concurrency,
        noHandleSignals: input.noHandleSignals,
        logger: input.logger,
      },
      input.tasks,
      input.pool,
    );
  }
}

export interface WorkerHostPluginOptions {
  readonly pool: Pool;
  readonly runtime?: WorkerRuntime;
  readonly logSink?: WorkerLogSink;
  readonly staleAfterMs?: number;
  readonly reconciliationIntervalMs?: number;
  readonly now?: () => Date;
}

const sourceJobPayload = z
  .object({
    notebookId: z.uuid(),
    sourceId: z.uuid(),
  })
  .strict();

export function workerHostPlugin(options: WorkerHostPluginOptions) {
  return definePlugin({
    id: "worker-host",
    provides: WORKER_HOST,
    requires: { sourceIngestion: SOURCE_INGESTION },
    config: noConfig,
    async setup({ dependencies, lifetime }): Promise<WorkerHost> {
      const runtime = options.runtime ?? new GraphileWorkerRuntime();
      const logger = createSafeWorkerLogger(options.logSink ?? consoleWorkerLogSink);
      const staleAfterMs = positiveDuration(options.staleAfterMs ?? 15 * 60_000, "staleAfterMs");
      const reconciliationIntervalMs = positiveDuration(
        options.reconciliationIntervalMs ?? 60_000,
        "reconciliationIntervalMs",
      );
      const now = options.now ?? (() => new Date());
      const reconcile = (): Promise<number> =>
        dependencies.sourceIngestion.reconcileStale({
          before: new Date(now().valueOf() - staleAfterMs).toISOString(),
          limit: 100,
        });

      await reconcile();
      const tasks: TaskList = {
        process_source: createProcessSourceTask(dependencies.sourceIngestion),
      };
      const process = runtime.start({
        pool: options.pool,
        tasks,
        logger,
        concurrency: 2,
        noHandleSignals: true,
      });
      lifetime.defer(async () => {
        await process.gracefulShutdown("Application stopping.");
        await process.promise;
      });
      const reconciliationTimer = setInterval(() => {
        void reconcile().catch(() => logger.error("Source reconciliation failed."));
      }, reconciliationIntervalMs);
      reconciliationTimer.unref();
      lifetime.defer(() => clearInterval(reconciliationTimer));
      return Object.freeze({ concurrency: 2 });
    },
  });
}

function positiveDuration(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer number of milliseconds.`);
  }
  return value;
}

function createProcessSourceTask(sourceIngestion: SourceIngestion): NonNullable<TaskList[string]> {
  return async (payload) => {
    const parsed = sourceJobPayload.safeParse(payload);
    if (!parsed.success) {
      throw new Error("Invalid process_source payload.");
    }
    await sourceIngestion.process(parsed.data.notebookId, parsed.data.sourceId);
  };
}

function createSafeWorkerLogger(sink: WorkerLogSink): Logger {
  return new Logger((scope) => (level) => {
    sink.write({
      event: "worker.runtime",
      level,
      ...(scope.label ? { label: scope.label } : {}),
      ...(scope.workerId ? { workerId: scope.workerId } : {}),
      ...(scope.taskIdentifier ? { taskIdentifier: scope.taskIdentifier } : {}),
      ...(scope.jobId ? { jobId: scope.jobId } : {}),
    });
  });
}

const consoleWorkerLogSink: WorkerLogSink = {
  write(record): void {
    console.log(JSON.stringify(record));
  },
};
