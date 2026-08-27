import { AsyncLocalStorage } from "node:async_hooks";
import type { SourceBlobReferenceCoordinator } from "@cangshu/application";
import type { Pool, PoolClient } from "pg";

interface LockSession {
  readonly client: PoolClient;
  readonly acquired: string[];
  readonly held: Set<string>;
  acquisition: Promise<void>;
}

export class PostgresSourceBlobReferenceCoordinator implements SourceBlobReferenceCoordinator {
  private readonly sessions = new AsyncLocalStorage<LockSession>();

  constructor(private readonly pool: Pool) {}

  async withLocks<T>(lockIds: readonly string[], operation: () => Promise<T>): Promise<T> {
    const orderedIds = [...new Set(lockIds)].sort();
    if (orderedIds.length === 0) {
      return operation();
    }

    const existing = this.sessions.getStore();
    if (existing) {
      await this.acquire(existing, orderedIds);
      return operation();
    }

    const client = await this.pool.connect();
    const session: LockSession = {
      client,
      acquired: [],
      held: new Set(),
      acquisition: Promise.resolve(),
    };
    return this.sessions.run(session, async () => {
      let releaseWithError = false;
      try {
        await this.acquire(session, orderedIds);
        return await operation();
      } finally {
        try {
          for (const lockId of [...session.acquired].reverse()) {
            await client.query("select pg_advisory_unlock(hashtextextended($1::text, 0))", [
              lockId,
            ]);
          }
        } catch {
          releaseWithError = true;
        }
        client.release(releaseWithError);
      }
    });
  }

  private async acquire(session: LockSession, orderedIds: readonly string[]): Promise<void> {
    session.acquisition = session.acquisition.then(async () => {
      for (const lockId of orderedIds) {
        if (session.held.has(lockId)) {
          continue;
        }
        const lastAcquired = session.acquired.at(-1);
        if (lastAcquired !== undefined && lockId < lastAcquired) {
          throw new Error("Reference locks must be acquired in stable order.");
        }
        await session.client.query("select pg_advisory_lock(hashtextextended($1::text, 0))", [
          lockId,
        ]);
        session.acquired.push(lockId);
        session.held.add(lockId);
      }
    });
    await session.acquisition;
  }
}
