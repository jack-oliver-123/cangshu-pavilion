# Store original Sources in a content-addressed local volume

Original Source bytes will be written to a persistent local volume under content hashes while PostgreSQL stores metadata and references. This makes duplicate bytes share storage, keeps database backup responsibilities clear, and leaves room for a future object-storage Adapter without making S3 or database binary storage prerequisites for a single-user deployment.
