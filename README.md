# High-Throughput Transaction Import & Reconciliation Service

A production-oriented Node.js 22 + TypeScript service that streams large NDJSON transaction files, processes them asynchronously, offloads CPU risk scoring to Worker Threads, prevents duplicate transactions via PostgreSQL unique constraints, and exposes reconciliation reports via an Express HTTP API.

---

## Technical Stack & Architecture

- **Runtime**: Node.js 22+ (TypeScript ES2022)
- **HTTP Framework**: Express
- **Database & ORM**: PostgreSQL 16 + Drizzle ORM
- **Concurrency & CPU Isolation**: Node `worker_threads` reusable worker pool
- **Validation & Parsing**: Zod schema validation & streaming readline NDJSON parser
- **Containerization**: Docker & Docker Compose

---

## Quick Start

### 1. Prerequisites
- Node.js 22 or later
- Docker and Docker Compose

### 2. Environment Setup
Copy the example environment configuration:
```bash
cp .env.example .env
```

### 3. Start PostgreSQL Container
```bash
docker compose up -d postgres
```

Or start the complete containerised stack:
```bash
docker compose up --build
```

### 4. Run Database Migrations
```bash
npm run db:migrate
```

### 5. Start Application
```bash
# Development mode with auto-reload
npm run dev

# Production build and start
npm run build
npm start
```

The API server will listen on `http://localhost:3000`.

Interactive API documentation is available at **`http://localhost:3000/docs`** (Swagger UI).

---

## Generating Test Data & Running Benchmarks

### Generate Sample NDJSON Files
To generate test NDJSON transaction files:
```bash
npm run generate:data -- --records=500000
```
This writes a test dataset to `./sample_transactions.ndjson`.

### Run Performance Benchmark
To run an automated end-to-end performance benchmark:
```bash
npm run benchmark -- --records=10000
```

---

## Running Tests

### Unit Tests (with Fake Repositories)
```bash
npm test
```

### Integration Tests (PostgreSQL Database)
```bash
npm run test:integration
```

### Run All Tests
```bash
npm run test:all
```

### Type-check everything (src, tests, scripts)
```bash
npm run typecheck
```

---

## API Endpoints Summary

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/v1/imports` | Create import job (`Idempotency-Key` header required, returns `202 Accepted`) |
| `GET` | `/v1/imports/:id` | Get import processing status & live progress counters |
| `POST` | `/v1/imports/:id/cancel` | Request import job cancellation |
| `GET` | `/v1/imports/:id/summary` | Get reconciliation breakdown by currency, risk level, merchant, and account |
| `GET` | `/v1/imports/:id/rejections` | Get rejected records with cursor-based pagination (`limit`, `cursor`) |
| `GET` | `/health/live` | Process liveness health check |
| `GET` | `/health/ready` | Database readiness check |
| `GET` | `/metrics` | Prometheus metrics endpoint (event loop delay, memory, CPU, counters) |
| `GET` | `/docs` | Swagger UI for interactive API exploration |

---

## Environment Variables

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | HTTP server listening port |
| `DATABASE_URL` | `postgres://postgres:postgres@127.0.0.1:5433/transaction_db` | PostgreSQL connection string |
| `MAX_FILE_SIZE_BYTES` | `524288000` (500MB) | Maximum file upload size |
| `TEMP_UPLOAD_DIR` | `./uploads` | Temporary file storage path |
| `WORKER_CONCURRENCY` | `4` | Risk-scoring worker threads. **Tune per machine** — scoring is CPU-bound, so past the fast physical core count extra threads slow batches down rather than speeding them up. Measure with `npm run benchmark`. |
| `BATCH_SIZE` | `1000` | Database insert batch size |
| `MAX_ACTIVE_IMPORTS` | `2` | Maximum imports processed concurrently |
| `MAX_PENDING_IMPORTS` | `20` | Maximum queued uploads; further requests receive 429 |
| `MAX_PERSISTED_REJECTIONS` | `10000` | Cap on rejection rows stored per import; counters still reflect every rejected record |
| `RETRY_MAX_ATTEMPTS` | `4` | Maximum attempts for a retryable batch write |
| `RETRY_INITIAL_DELAY_MS` | `100` | First retry backoff before jitter |
| `RETRY_MAX_DELAY_MS` | `3000` | Backoff ceiling |
| `SHUTDOWN_GRACE_PERIOD_MS` | `30000` | Maximum time allowed for graceful shutdown before forced exit |
| `JOB_LEASE_TTL_MS` | `60000` | How long an import's processing lease stays valid without a batch commit; only lapsed leases are reclaimed on startup |
| `LOG_LEVEL` | `info` | Pino log level (`debug` adds per-batch records) |
| `AUTO_MIGRATE` | `true` | Set `false` to skip running migrations at startup |

---

## Observability

### Structured logging
All logs are newline-delimited JSON written to stdout via Pino. Every HTTP request carries a correlation id — taken from an inbound `X-Request-Id` when it is a safe short token, otherwise generated — which is echoed in the response header, included in every error envelope, and bound to a child logger for the life of the request. Background work logs with `importId`, `providerId`, `batchNumber`, `recordCount`, and `durationMs`; shutdown logs carry `signal` and `shutdownState`. Transaction descriptions and raw rejected values are redacted at the logger root, so uploaded content never reaches the log stream. Because every field is JSON-encoded, newlines in untrusted input cannot forge a log line.

The logger is injected, not imported: application and domain code depends on the `ILogger` port in [src/domain/logging/logger.interface.ts](src/domain/logging/logger.interface.ts), the Pino adapter lives in [src/infrastructure/logging/pino-logger.ts](src/infrastructure/logging/pino-logger.ts), and the two are wired together only in [src/index.ts](src/index.ts). Components default to a silent logger so tests stay quiet without stubbing.

Set `LOG_LEVEL=debug` to add per-batch records (scoring duration, commit duration, per-batch counts).

### Event-loop & health monitoring
`GET /metrics` exposes event-loop delay percentiles, event-loop utilization, RSS and heap, CPU time, active imports, queue depth, worker-pool occupancy, retry attempts, inline-fallback count, processing failures, and record counters. No identifier is used as a metric label, so cardinality stays flat.

- **How blocking is detected**: `perf_hooks.monitorEventLoopDelay()` samples the lag between when a timer should fire and when it does; `performance.eventLoopUtilization()` reports the fraction of wall time the loop spent working rather than idle.
- **Thresholds worth alerting on**: event-loop delay P99 above ~50 ms, or utilization sustained above ~0.85.
- **CPU saturation vs. downstream I/O latency**: CPU saturation shows high utilization *and* high delay together — the loop is busy. Slow downstream I/O shows the opposite signature: request latency rises while utilization stays low and delay stays flat, because the process is waiting, not computing. Distinguishing them tells you whether to add workers or to look at the database.
- **What could still block the loop**: `JSON.parse` of each line and the SHA-256 fingerprint are on the main thread (both are microsecond-scale per record, and the batch boundary yields between them); the inline scoring fallback would block heavily, which is why it only runs when no worker pool could be created at all.
- **How latency-sensitive endpoints are protected**: risk scoring — the only genuinely expensive work — runs on worker threads; imports are bounded by a queue that returns 429 rather than accumulating work; and reading is throttled by stream backpressure so a large file cannot outpace the pipeline.

---

## Known Limitations

- **Single Node Queue**: Background processing uses an in-process bounded queue with worker threads. For multi-node distributed deployments across Kubernetes pods, a distributed Redis-backed queue (e.g. BullMQ) can be added as a worker transport.
- **Summary cardinality**: Reconciliation summaries return complete currency and risk-level breakdowns, while `byMerchant` and `byAccount` return the top 100 groups ordered by total amount. This keeps response size bounded for imports with many distinct identifiers; full group listings would require a separate paginated endpoint.
- **Delivery model**: **effectively-once for accepted transactions, at-least-once for progress counters.** Each batch commits its rows and its counter update in one database transaction, and duplicate transactions are prevented by `UNIQUE (provider_id, transaction_id)`. If a commit succeeds but its acknowledgement is lost, a retry re-applies the counter increments and re-inserts rejection rows, so counters can overcount for that batch; closing this needs a per-batch claim key keyed by `(import_id, batch_number)`, which is not implemented. A process interruption marks an active import `failed` on restart rather than resuming it — automatic redelivery would need a distributed queue.
- **Pending imports are not re-queued**: the job queue is in-process, so an import that crashed before processing began stays `pending` rather than being picked up on restart.
