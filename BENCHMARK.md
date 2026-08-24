# Benchmark Report

## How to reproduce

```bash
docker compose up -d postgres
npm run db:migrate
npm run dev            # in a second terminal
npm run benchmark -- --records=500000
```

The script generates the dataset, uploads it, polls `GET /v1/imports/:id` every 100ms until the
import finishes, and samples `GET /metrics` on each poll. Throughput is measured end to end: the
clock starts before the upload and stops when the import reports `completed`.

Start from an empty database. Transaction ids are unique per provider, so re-running without
truncating makes the second run collide with the first and report conflicts instead of accepts.

## Machine

| | |
| :--- | :--- |
| CPU | Apple M1, 8 cores (4 performance + 4 efficiency) |
| Memory | 8 GB |
| Node | v24.14.0 |
| PostgreSQL | 16.13 |
| Worker concurrency | 4 (default) |
| Database batch size | 1,000 (default) |

## Results — 500,000 records

| Metric | Value |
| :--- | :--- |
| Dataset size | 500,000 records (~110 MB) |
| Total duration | 450.3 s |
| Throughput | 1,110 records/sec |
| API latency P50 (during import) | 3.8 ms |
| API latency P99 (during import) | 392 ms |
| Peak RSS | 642 MB |
| Peak heap used | 120 MB |
| Event-loop delay P99 | 45.8 ms |
| Event-loop utilization | 14.6 % |
| Accepted / rejected / duplicates | 500,000 / 0 / 0 |

Correctness was checked against the database afterwards, not just the API response:

| Source | Count |
| :--- | :--- |
| `imports.accepted_count` | 500,000 |
| `SELECT count(*) FROM transactions` | 500,000 |
| `SELECT count(*) FROM rejections` | 0 |

## What the numbers mean

**The API stays responsive.** Median latency was 3.8 ms while 500,000 records were being scored
and written. This is the main thing the worker pool buys: scoring never runs on the request
thread. The 392 ms P99 comes from the upload window at the start, when a ~110 MB multipart body
is being received and streamed to disk by the same process.

**Memory is flat, not proportional to the file.** Peak heap was 120 MB for a 110 MB file, and it
does not grow with file size — a separate test measured ~82 MB of heap for both a 72 MB and a
216 MB file. Only one batch plus readline's buffer is ever live. Peak RSS is higher than heap
because it includes four worker threads, each with its own V8 isolate.

**Throughput is dominated by the risk scorer, deliberately.** The scorer runs 500 SHA-256 rounds
per record to simulate CPU-intensive work. Measured in isolation, one thread does ~1,700
records/sec and the pool plateaus around ~3,000 records/sec from three workers upward. The
end-to-end figure of 1,110 records/sec is lower because scoring and the database write happen in
sequence per batch.

## Bottleneck

The batch cycle is serial: a batch is scored with all workers busy, then written with all workers
idle. The two phases are roughly the same length, so about half the wall time has the pool doing
nothing.

The clearest next improvement is to overlap them — score batch N+1 while batch N is being
written. That should approach a 2x gain without adding hardware. It is not implemented because it
complicates the backpressure and bounded-memory guarantees, which are currently simple to reason
about and easy to demonstrate.

After that: hand the multipart stream straight to `IFileStorage` so a large upload is not written
to disk twice, and use `COPY ... FROM STDIN` into a staging table instead of multi-row `INSERT`.

## Did it meet expectations?

Yes for the stated requirements. The target was to *design for* 500,000 records with bounded
memory, bounded concurrency, batched writes, and a responsive API. All four hold: heap is flat,
concurrency is bounded at the queue, the worker pool, and the batch size, every write is batched,
and median API latency stayed under 4 ms throughout.

Absolute throughput is modest and expected to be — the artificial CPU cost per record sets the
ceiling. The meaningful result is that the cost is isolated from the request path, not the number
itself.
