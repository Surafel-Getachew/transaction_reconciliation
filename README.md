# Transaction Import and Reconciliation Service

This service accepts large NDJSON transaction files, validates them, calculates a risk score, and stores the results in PostgreSQL.

## Stack

- Node.js 22 and TypeScript
- Express
- PostgreSQL and Drizzle ORM
- Node worker threads for risk scoring
- Docker for local setup

## Run locally

Requirements: Node.js 22+, Docker, and Docker Compose.

```bash
cp .env.example .env
npm install
docker compose up -d postgres
npm run db:migrate
npm run dev
```

The API runs at `http://localhost:3000`.

- Swagger UI: `http://localhost:3000/docs`
- Liveness: `http://localhost:3000/health/live`
- Readiness: `http://localhost:3000/health/ready`
- Metrics: `http://localhost:3000/metrics`

To run the full Docker stack:

```bash
docker compose up --build
```

## Tests and benchmarks

```bash
npm test                 # unit tests
npm run test:integration # PostgreSQL integration tests
npm run test:all         # all tests
npm run typecheck        # TypeScript checks
npm run benchmark -- --records=10000
npm run generate:data -- --records=500000
```

## Project documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md): system design and processing behavior.
- [`docs/adr/`](docs/adr/): short records of the main design choices.
- [`BENCHMARK.md`](BENCHMARK.md): measured performance and what the numbers mean.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/imports` | Upload an NDJSON file. Requires `Idempotency-Key`. |
| GET | `/v1/imports/:id` | Get status and progress. |
| POST | `/v1/imports/:id/cancel` | Cancel an import. |
| GET | `/v1/imports/:id/summary` | Get totals and grouped results. |
| GET | `/v1/imports/:id/rejections` | Get rejected records with pagination. |
| GET | `/docs` | Open Swagger UI. |

The upload field is named `file`. The service returns `202 Accepted` after the file is saved and queued.

## Main environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port. |
| `DATABASE_URL` | local PostgreSQL URL | PostgreSQL connection string. |
| `TEMP_UPLOAD_DIR` | `./uploads` | Temporary upload directory. |
| `MAX_FILE_SIZE_BYTES` | `524288000` | Maximum upload size. |
| `WORKER_CONCURRENCY` | `4` | Risk-scoring workers. |
| `BATCH_SIZE` | `1000` | Records handled per database batch. |
| `MAX_ACTIVE_IMPORTS` | `2` | Imports processed at once. |
| `MAX_PENDING_IMPORTS` | `20` | Queue capacity. |
| `JOB_LEASE_TTL_MS` | `60000` | Processing lease duration. |
| `RETRY_MAX_ATTEMPTS` | `4` | Maximum database batch retry attempts. |
| `AUTO_MIGRATE` | `true` | Run migrations when the service starts. |

See `.env.example` for the full list.

## Processing behavior

1. Multer saves the upload to a temporary file.
2. The import is stored in PostgreSQL and added to a bounded queue.
3. The file is read line by line.
4. Invalid lines are stored as rejections.
5. Valid records are normalized, fingerprinted, risk-scored, and written in batches.
6. The temporary file is deleted when processing finishes.

Risk scoring is deterministic. It uses amount, description length, transaction hour, merchant id, and the fingerprint. Amount scoring is logarithmic. The final SHA-256 digest adds a small fingerprint-based score. The total is between 0 and 100:

- 0-39: low
- 40-69: medium
- 70-100: high

Each batch is split across the worker pool so one import can use more than one worker.

## Safety limits

- Upload size, request size, multipart fields, and queue size are limited.
- NDJSON is checked by content and validated line by line.
- Long lines are limited before parsing.
- Database writes use batches and transactions.
- PostgreSQL prevents duplicate `(provider_id, transaction_id)` rows.
- Batch database writes use bounded retries with backoff and jitter.
- Logs use request ids and do not expose uploaded data.
- Merchant and account summary results are limited to the top 100 groups by total amount. Currency and risk summaries are complete.

## Deployment

Railway is suitable for the current version:

1. Deploy the Dockerfile as the application service.
2. Add Railway PostgreSQL in the same project and environment.
3. Set `DATABASE_URL` in the app service to `${{Postgres.DATABASE_URL}}`.
4. Set `TEMP_UPLOAD_DIR` to the mounted upload directory.
5. Keep one app replica for the current in-process queue and local file storage.

Current deployment: https://transactionreconciliation-production.up.railway.app

Swagger UI: https://transactionreconciliation-production.up.railway.app/docs

## Known limitations

- The queue is in memory, so it is not a shared queue for multiple replicas.
- Lease fields and stale-job recovery are present, but progress and completion updates are not yet protected by an owner token. Full multi-instance safety needs fenced updates and a shared queue.
- Upload files are local temporary files. Multiple replicas need shared object storage.
- Import-level retry and redelivery are not implemented. Failed imports are marked failed and their temporary files are deleted. A retry endpoint can be added later with durable file storage, a persistent queue, and attempt tracking.
- Duplicate transactions use first-write-wins. Identical replays are counted as duplicates. If the same transaction id has a different fingerprint, the later record is rejected with `DUPLICATE_CONTENT_MISMATCH` and remains visible through the rejections endpoint.
- Summary queries still aggregate raw transactions. The response is bounded, but precomputed summary tables would reduce database work for very large imports.
