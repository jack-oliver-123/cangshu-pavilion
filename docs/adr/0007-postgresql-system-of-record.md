# Use PostgreSQL with pgvector as the system of record

PostgreSQL will store Notebook, Source, processing state, extracted passages, embeddings, Conversations, Messages, Citations, Notes, credentials, and durable job metadata; pgvector will provide vector search within the same transactional store. Original Source bytes remain outside the database, but the MVP will not split domain state, messages, jobs, and vectors across independent databases because consistent deletion, backup, recovery, and Notebook-scoped retrieval matter more than an embedded single-file deployment.
