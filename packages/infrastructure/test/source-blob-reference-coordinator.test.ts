import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresSourceBlobReferenceCoordinator } from "../src/database/source-blob-reference-coordinator.js";

describe("PostgresSourceBlobReferenceCoordinator", () => {
  it("reuses one PostgreSQL session for nested Notebook and blob locks", async () => {
    const query = vi.fn(async (_statement: string, _parameters?: readonly unknown[]) => ({
      rows: [],
    }));
    const release = vi.fn();
    const client = { query, release } as unknown as PoolClient;
    const connect = vi.fn(async () => client);
    const pool = { connect } as unknown as Pool;
    const coordinator = new PostgresSourceBlobReferenceCoordinator(pool);

    await coordinator.withLocks(["0:notebook:one"], async () => {
      await coordinator.withLocks(["1:blob:shared"], async () => undefined);
    });

    expect(connect).toHaveBeenCalledOnce();
    expect(query.mock.calls.map(([, parameters]) => parameters)).toEqual([
      ["0:notebook:one"],
      ["1:blob:shared"],
      ["1:blob:shared"],
      ["0:notebook:one"],
    ]);
    expect(release).toHaveBeenCalledOnce();
  });
});
