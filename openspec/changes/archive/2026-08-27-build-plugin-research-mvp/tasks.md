## 1. Workspace and Plugin Runtime

- [x] 1.1 Scaffold the pnpm TypeScript workspace, shared strict compiler settings, Biome quality gate, package scripts, environment example, and ignore files
- [x] 1.2 Implement the boot-once Plugin Kernel with full preflight, stable topological startup, atomic Capability publication, partial rollback, aggregated cleanup, idempotent stop, safe snapshots, and contract tests
- [x] 1.3 Define domain records, stable application errors, local-substitutable ports, true-external model ports, and the deep application Capability Interfaces
- [x] 1.4 Add Kernel tests for unknown configuration keys, self-dependency, duplicate requirement aliases, invalid identifiers, post-setup cleanup registration, and rollback cleanup aggregation

## 2. PostgreSQL System of Record

- [x] 2.1 Define the Drizzle schema and initial migration for Notebook, Source, SourceProcessingAttempt, Passage/pgvector, Conversation, Message, Citation, Note, and ProviderConfiguration with composite Notebook ownership constraints
- [x] 2.2 Complete PostgreSQL Repository Adapters for all application ports, including explicit delete results and reference-safe blob cleanup decisions
- [x] 2.3 Add transaction integration tests proving atomic Source completion, assistant Message/Citation completion, and Source Attempt failure/completion transitions
- [x] 2.4 Add isolation integration tests proving cross-Notebook Message, Passage, Citation, Note, retrieval, and mutation attempts fail
- [x] 2.5 Add database migration and Graphile schema bootstrap commands that are safe on both empty and existing databases

## 3. Source Storage and Extraction

- [x] 3.1 Implement atomic SHA-256 content-addressed blob storage with safe key validation, read, idempotent put, and idempotent delete
- [x] 3.2 Implement Text and Markdown extraction into line-located blocks and contract tests for blank lines, Unicode, long content, and stable line ranges
- [x] 3.3 Implement text-layer PDF extraction into page-located blocks and fixtures for multi-page, empty-page, malformed, and scanned PDFs
- [x] 3.4 Implement Readability-based webpage extraction with paragraph locators and title handling
- [x] 3.5 Implement pinned-DNS SSRF protection for HTTP/HTTPS, redirects, address ranges, credentials, response limits, and timeouts with security tests
- [x] 3.6 Complete Passage splitting with stable ordinals, overlap, token estimates, exact locator ranges, and boundary tests

## 4. Durable Source Processing

- [x] 4.1 Implement a reusable Graphile Worker queue Adapter with `source:<id>` job keys, bounded attempts, queue migration, and lifecycle cleanup
- [x] 4.2 Implement the Worker Host Plugin and `process_source` task with payload validation, at-least-once idempotency, two-job concurrency, graceful shutdown, and safe logging
- [x] 4.3 Complete SourceIngestion import, duplicate detection, retry, delete, and processing rules against the PostgreSQL, blob, extractor, queue, and Embedding Adapters
- [x] 4.4 Add integration tests for Worker restart, duplicate delivery, retryable/non-retryable failure projection, and no `ready` state before Passage commit
- [x] 4.5 Add a reconciliation path that requeues stale queued/processing Sources after an interrupted enqueue or Worker crash

## 5. Provider Configuration and Models

- [x] 5.1 Implement master-key loading from environment or a permission-restricted data-volume key file
- [x] 5.2 Implement versioned AES-256-GCM key encryption/decryption and tests for random nonce, tampering, wrong key, and plaintext absence
- [x] 5.3 Implement ProviderConfigurationVault with independent Chat/Embedding records, key preservation, public projections, and complete environment override precedence
- [x] 5.4 Implement OpenAI-compatible Embedding Adapter with model fingerprint, vector validation, bounded batching, timeout, and redacted errors
- [x] 5.5 Implement OpenAI-compatible streaming Chat Adapter with strict evidence prompt, `[P#]` label extraction, timeout, and redacted errors
- [x] 5.6 Implement minimal real-call Provider tests for Chat and Embedding and expose them through ProviderSettingsManagement

## 6. Grounded Answering and Notes

- [x] 6.1 Complete NotebookManagement with validated CRUD and reference-safe asynchronous blob cleanup behavior
- [x] 6.2 Complete ResearchAnswering with mandatory Notebook retrieval, current-model filtering, bounded Source-diverse evidence, Conversation history, and pending/completed/failed Message lifecycle
- [x] 6.3 Enforce Citation candidate membership, Notebook ownership, server-generated locator/excerpt, unknown-label rejection, and the canonical insufficient-evidence result
- [x] 6.4 Complete NoteManagement CRUD and save-answer Markdown projection with immutable Message/Citation provenance
- [x] 6.5 Add deterministic application contract tests for empty evidence, cross-Notebook candidates, invalid labels, multi-Source citations, Provider failure after deltas, and save-answer eligibility

## 7. Fastify HTTP and Security

- [x] 7.1 Implement runtime configuration validation, loopback detection, mandatory shared password for non-loopback binds, and safe startup errors
- [x] 7.2 Implement the HttpHost Plugin with consistent success/error envelopes, request IDs, body limits, redacted logging, liveness, and readiness
- [x] 7.3 Implement Notebook and Source JSON/multipart routes, Source retry/delete, and safe upload streaming
- [x] 7.4 Implement Conversation routes and answer SSE with named events, disconnect handling, terminal event guarantees, and proxy-safe headers
- [x] 7.5 Implement Note and Provider Settings/test routes with Notebook ownership and no secret projection
- [x] 7.6 Implement remote-mode login/logout, constant-time password verification, signed HttpOnly SameSite sessions, expiry, CSRF-aware same-origin checks, and login rate limiting
- [x] 7.7 Add Fastify injection tests for route contracts, validation envelopes, auth modes, multipart limits, SSE success/failure, and secret/log redaction

## 8. React Workbench

- [x] 8.1 Create the Vite React shell, typed HTTP client, SSE client, Simplified Chinese message catalog, global error handling, and stable responsive layout tokens
- [x] 8.2 Build Notebook navigation and create/rename/delete flows with empty, loading, error, and populated states
- [x] 8.3 Build Source import controls for file, URL, and pasted text plus processing status, failure detail, retry, delete, and refresh behavior
- [x] 8.4 Build Conversation history, question composer, streaming answer state, authoritative completion replacement, Citation controls, and save-as-Note action
- [x] 8.5 Build the Citation Source viewer with formatted locator, matching excerpt highlight, close/back behavior, and mobile layout
- [x] 8.6 Build Markdown Note list/editor/create/delete flows without nesting cards or losing unsaved-state feedback
- [x] 8.7 Build separate Chat/Embedding settings forms with source/has-key projection, key-preserving edits, test, save, and redacted errors
- [x] 8.8 Add keyboard, accessible-name, tooltip, focus, contrast, reduced-motion, overflow, and long-content coverage

## 9. Delivery and Verification

- [x] 9.1 Add a multi-stage Dockerfile and Docker Compose services for pgvector, migrate, Server/Web, and two-concurrency Worker with health checks and persistent volumes
- [x] 9.2 Add deterministic fixtures and end-to-end tests for two-Source import, Worker restart, cross-Source answer, exact Citation opening, insufficient evidence, and save/edit Note
- [x] 9.3 Run Playwright desktop and mobile screenshots, console/network checks, and layout-overlap checks for every primary state
- [x] 9.4 Run and fix `pnpm lint`, `pnpm typecheck`, `pnpm test`, production Web build, migration-from-empty, and `docker compose up --build` cold-start verification
- [x] 9.5 Write Chinese README setup, Provider configuration, supported formats/limits, localhost/remote security, backup/restore, troubleshooting, and architecture wayfinding
- [x] 9.6 Verify implementation against all six OpenSpec capability specs, update task checkboxes with evidence, and prepare the change for `openspec-verify-change`
