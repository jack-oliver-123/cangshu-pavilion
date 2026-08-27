# Run background work from a PostgreSQL-backed queue

Source processing will execute in a separate Worker process using durable PostgreSQL jobs with leases, retries, idempotency keys, and persisted stage checkpoints. The HTTP process will submit work and report state but will not own long-running Promises, and the MVP will not add Redis because PostgreSQL can provide the required durability and concurrency at the supported personal scale.
