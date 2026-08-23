# Benchmark & Performance Report

This document contains empirical performance benchmark results for the **High-Throughput Transaction Import and Reconciliation Service**, including system specs, throughput, API latency impact, memory metrics, and architectural observations.

## Benchmark Test Setup

- **Test Tool**: Custom benchmark runner script (`scripts/run-benchmark.ts`) sending streaming HTTP multipart NDJSON uploads, plus a polling harness that samples `GET /v1/imports/:id`, `GET /health/live`, `GET /v1/imports/:id/rejections`, and `GET /metrics` once per second for the entire duration of the import.
- **Dataset Size**: 500,000 NDJSON transaction records (100 MB), with one deliberately malformed line every 500 records (1,000 rejections total).
- **Database Batch Size**: 1,000 records per PostgreSQL transaction batch (`ON CONFLICT DO NOTHING`).
- **Worker Concurrency**: 6 Node `worker_threads` (`WORKER_CONCURRENCY=6`), CPU risk scoring off the HTTP event loop.
- **Machine Specifications**:
  - CPU: 8 Cores (Apple Silicon arm64)
  - System Memory: 8.00 GB RAM
  - Operating System: macOS (Darwin arm64)
  - Database: PostgreSQL 16 (Alpine Docker Container)

---

## Performance Summary — 500,000 records

| Metric | Measured Value | Notes |
| :--- | :--- | :--- |
| **Dataset Size** | 500,000 records (100 MB) | 499,000 accepted, 1,000 rejected |
| **Total Duration** | 344.8 seconds | Upload + full asynchronous processing |
| **Throughput** | **1,450 records/sec** | End-to-end, including upload |
| **API Latency (P50)** | **6.85 ms** | 528 samples taken *during* processing |
| **API Latency (P99)** | 179.87 ms | |
| **API Latency (max)** | 4,052 ms | One outlier during the 100 MB upload — see below |
| **Event-Loop Delay (P99)** | 87.8 ms | Peak over the whole run |
| **Peak Resident Memory (RSS)** | 571 MB | Main thread + 6 worker heaps; peak occurs during upload |
| **Peak Heap Usage** | 98.5 MB | Flat across the run — no accumulation |
| **Database Batch Size** | 1,000 items/batch | 500 batches, all committed exactly once |
| **Worker Concurrency** | 6 worker threads | All 6 busy simultaneously in 40% of samples |

### Correctness check alongside the numbers

A throughput figure means nothing if the data is wrong, so the same run was reconciled three ways:

| Source | Accepted count |
| :--- | :--- |
| `imports.accepted_count` (progress counter) | 499,000 |
| `SUM(import_batches.inserted_count)` (ledger) | 499,000 |
| `SELECT COUNT(*) FROM transactions` (actual rows) | 499,000 |

All 500 batches committed exactly once.

---

## Detailed Analysis & Bottlenecks

### 1. How API Responsiveness was Protected
Throughout the run the API was polled once per second across four endpoints (528 samples). The median response was **6.85 ms** while 500,000 records were being scored and written, because risk scoring — the only genuinely expensive work — runs on worker threads rather than the request thread.

The **4-second maximum** is honest and worth explaining rather than hiding: it occurs at the start, while the 100 MB multipart upload is being received and streamed to disk by the same process. That is I/O and stream plumbing on the main thread, not scoring. It affects the upload window only; once processing begins, latency settles back to single-digit milliseconds. Moving uploads behind a reverse proxy, or accepting them on a separate process, would remove it.

### 2. Worker Pool Utilization — the change that mattered
Sampling `app_risk_workers{state="busy"}` once per second across 182 samples:

| Workers busy | Samples |
| :--- | :--- |
| 6 (all) | 74 |
| 1–5 | 29 |
| 0 | 73 |

Previously each batch was posted to a **single** worker while the rest of the pool sat idle, so the pool was decorative and throughput was capped by one thread (measured at ~2,000 records/sec/thread for this scoring function — about 250 seconds of pure single-threaded CPU for 500k records). Splitting each batch into one chunk per worker is what puts all six to work.

The `0` samples are not idleness — they are the database-write phase of the batch cycle, which is now the limiting factor.

### 3. Memory Behavior
Peak heap stayed at **98.5 MB** across a 100 MB file — resident memory does not track file size, confirming the file is genuinely streamed. Backpressure comes from `for await (const line of rl)`: the async iterator stops pulling while the loop body awaits scoring and the database write, so only one batch plus readline's internal buffer is ever live.

Peak **RSS of 571 MB** is larger than heap because it includes six worker threads, each with its own V8 heap and isolate, plus the OS page cache for the upload. It is bounded and flat, not growing.

### 4. Identified Bottleneck & What to Improve Next
- **Current bottleneck: the batch cycle is serial.** A batch is scored (all workers busy) and *then* written (all workers idle), and the two phases are roughly the same length. The single highest-value change is to **pipeline them** — score batch N+1 while batch N is being written — which should approach a 2× improvement without adding hardware.
- **Second: the upload path.** Multer stages the upload to a temporary file and the use case then copies that stream into storage, so a 100 MB file is written to disk twice. Handing the multipart stream directly to `IFileStorage` removes one full copy and most of the latency outlier above.
- **Third: `COPY` instead of multi-row `INSERT`.** For the accepted-transaction path, `COPY ... FROM STDIN` into a staging table followed by an `INSERT ... ON CONFLICT DO NOTHING` is substantially faster than parameterised multi-row inserts at this batch size.
- **Then**: a Redis/Postgres-backed distributed queue for cross-process scaling, and connection-pool tuning driven by observed write queue depth.

### 5. Did it meet expectations?
The requirement was to *design for* at least 500,000 records with bounded memory, bounded concurrency, batched writes, and a responsive API. All four hold: memory is flat, concurrency is bounded at every stage (queue, workers, batch size), every write is batched and committed exactly once, and median API latency stayed under 7 ms during the run.

Absolute throughput (1,450 rec/s) is modest, and deliberately so — the risk scorer performs 500 SHA-256 rounds per record to simulate CPU-intensive work, which is by far the dominant per-record cost. The meaningful result is not the number itself but that the CPU work scales across workers and stays off the request path.
