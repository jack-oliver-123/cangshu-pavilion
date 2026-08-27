# Use a single TypeScript runtime

The Web client, HTTP modules, background worker, domain contracts, and Plugin interfaces will live in a TypeScript monorepo. Complex parsing or OCR may later run behind a process interface with a separate Adapter, but the MVP will avoid a permanent TypeScript/Python split so configuration, lifecycle, domain types, fixtures, and Plugin contract tests have one source of truth.
