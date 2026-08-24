# Submission Notes

## Deployment

Public API: https://transactionreconciliation-production.up.railway.app

Swagger UI: https://transactionreconciliation-production.up.railway.app/docs

The application and Railway PostgreSQL database are in the same project and environment. The current deployment uses one application replica because the queue and temporary upload storage are local to the process.

## Summary

This service accepts large NDJSON transaction files and processes them in the background. It validates and normalizes each record, calculates a deterministic risk score, stores accepted transactions, records rejected lines, and exposes status, summary, and rejection endpoints.

## Architecture

- Express handles uploads and HTTP responses.
- A bounded in-process queue limits active and waiting imports.
- The processor reads files line by line and writes records in batches.
- Risk scoring runs in a reusable worker-thread pool.
- PostgreSQL stores imports, idempotency keys, transactions, and rejections.
- PostgreSQL constraints prevent duplicate accepted transactions.
- Batch writes use transactions and a bounded retry policy.
- Import leases record the current owner, expiry time, and attempt count.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full flow and design details.

## Important decisions

- Use a bounded local queue so overload returns `429` instead of building an unbounded promise queue.
- Use worker threads because risk scoring is CPU-heavy.
- Use PostgreSQL constraints for duplicate protection and idempotency.
- Keep the first transaction when the same provider and transaction id appear more than once.
- Record `DUPLICATE_CONTENT_MISMATCH` when the later record has different content.
- Return only the top 100 merchant and account groups so summary responses stay bounded.

## Trade-offs

- The local queue is simple and works well for one service instance, but it is not shared between replicas.
- Upload files are temporary local files, so multiple replicas need shared object storage.
- Summary queries still aggregate the transaction table at request time. The response is bounded, but precomputed summary tables would reduce database work.
- Risk scoring is intentionally CPU-heavy for the assignment, so total throughput depends on the machine's CPU.

## Benchmark summary

The benchmark processed 500,000 records with a 100 MB NDJSON file.

- Duration: 344.8 seconds
- End-to-end throughput: 1,450 records/second
- Accepted: 499,000
- Rejected: 1,000
- API latency during processing: 6.85 ms P50 and 179.87 ms P99
- Peak heap: 98.5 MB
- Worker threads: 6

The main bottleneck is the CPU-heavy risk scorer and the serial score-then-write batch cycle. The next performance improvement would be pipelining scoring and database writes.

See [`BENCHMARK.md`](BENCHMARK.md) for the test setup and analysis.

## Known risks

- Progress and completion updates do not yet use an owner token, so a stale worker could write after its lease expires.
- The queue is local to one process and does not support distributed job consumption.
- A process failure does not automatically replay a complete import.
- An ambiguous database commit can overcount progress counters, although accepted transaction rows remain protected by the unique constraint.

## Future work

- Add owner-token or fencing checks to every job update.
- Use a shared queue or PostgreSQL job polling for multiple replicas.
- Move uploads to S3-compatible object storage.
- Add a persisted batch claim table to make progress updates exactly once.
- Add import retry and redelivery with bounded attempts.
- Add paginated full merchant and account summaries if clients need more than the top 100.
