# ADR 0001: Use a bounded in-process job queue

## Decision

Use an in-process queue with limits for active and pending imports.

## Reason

The application runs as one Node.js service. A local queue is simple, easy to test, and gives clear backpressure. The API returns `429` when the queue is full.

## Trade-off

The queue is not shared between replicas. A future multi-instance version should use PostgreSQL job polling or a queue such as Redis/BullMQ.
