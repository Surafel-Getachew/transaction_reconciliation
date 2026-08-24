# ADR 0003: Use PostgreSQL constraints and batch transactions for consistency

## Decision

Use PostgreSQL for imports, transactions, rejections, progress, and idempotency keys. Write each processing batch in one database transaction.

## Reason

The unique `(provider_id, transaction_id)` constraint prevents accepted duplicates. The idempotency key and advisory lock prevent duplicate import creation. A batch transaction keeps its rows and progress update together.

## Trade-off

The current design has no import-level redelivery after a process failure, and an ambiguous commit can make progress counters overcount. A future batch-claim table would close that gap.
