import { SOURCE_INGESTION, type SourceIngestion } from "@cangshu/application";
import { definePlugin, noConfig, startApplication } from "@cangshu/plugin-kernel";
import type { Logger, TaskList } from "graphile-worker";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  type WorkerLogRecord,
  type WorkerProcess,
  type WorkerRuntime,
  type WorkerRuntimeInput,
  workerHostPlugin,
} from "../src/worker/worker-host-plugin.js";

class CapturingRuntime implements WorkerRuntime {
  input?: WorkerRuntimeInput;
  readonly gracefulShutdown = vi.fn(async () => undefined);
  readonly process: WorkerProcess = {
    gracefulShutdown: this.gracefulShutdown,
    promise: Promise.resolve(),
  };

  start(input: WorkerRuntimeInput): WorkerProcess {
    this.input = input;
    return this.process;
  }
}

const callTask = async (tasks: TaskList, payload: unknown): Promise<void> => {
  const task = tasks.process_source;
  if (!task) {
    throw new Error("process_source was not registered");
  }
  await task(payload, {} as never);
};

describe("Worker Host Plugin", () => {
  it("validates payloads, uses concurrency two, redacts logs, and shuts down gracefully", async () => {
    vi.useFakeTimers();
    const process = vi.fn(async () => undefined);
    const reconcileStale = vi.fn(async () => 0);
    const sourceIngestion = {
      process,
      reconcileStale,
    } as unknown as SourceIngestion;
    const sourcePlugin = definePlugin({
      id: "test-source-ingestion",
      provides: SOURCE_INGESTION,
      requires: {},
      config: noConfig,
      setup: () => sourceIngestion,
    });
    const runtime = new CapturingRuntime();
    const logs: WorkerLogRecord[] = [];
    const workerPlugin = workerHostPlugin({
      pool: {} as Pool,
      runtime,
      logSink: { write: (record) => logs.push(record) },
      staleAfterMs: 60_000,
      reconciliationIntervalMs: 1_000,
      now: () => new Date("2026-08-27T05:00:00.000Z"),
    });

    try {
      const application = await startApplication({ plugins: [sourcePlugin, workerPlugin] });
      expect(runtime.input?.concurrency).toBe(2);
      expect(runtime.input?.noHandleSignals).toBe(true);
      expect(reconcileStale).toHaveBeenCalledWith({
        before: "2026-08-27T04:59:00.000Z",
        limit: 100,
      });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(reconcileStale).toHaveBeenCalledTimes(2);

      await expect(
        callTask(runtime.input?.tasks ?? {}, { notebookId: "not-a-uuid", sourceId: "also-bad" }),
      ).rejects.toThrow("Invalid process_source payload.");
      expect(process).not.toHaveBeenCalled();

      const payload = {
        notebookId: "11111111-1111-4111-8111-111111111111",
        sourceId: "22222222-2222-4222-8222-222222222222",
      };
      await callTask(runtime.input?.tasks ?? {}, payload);
      await callTask(runtime.input?.tasks ?? {}, payload);
      expect(process).toHaveBeenCalledTimes(2);
      expect(process).toHaveBeenLastCalledWith(payload.notebookId, payload.sourceId);

      const logger = runtime.input?.logger;
      expect(logger).toBeDefined();
      (logger as Logger).error(
        "Provider failed with Authorization: Bearer private-token and source body",
        { payload: { secret: "private-token" } },
      );
      expect(JSON.stringify(logs)).not.toContain("private-token");
      expect(JSON.stringify(logs)).not.toContain("source body");

      await application.stop();
      await application.stop();
      expect(runtime.gracefulShutdown).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(reconcileStale).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
