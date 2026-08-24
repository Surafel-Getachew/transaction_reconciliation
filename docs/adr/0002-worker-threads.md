# ADR 0002: Use a reusable worker-thread pool for risk scoring

## Decision

Run risk scoring in a fixed pool of Node.js worker threads. Split each batch into chunks and send the chunks to available workers.

## Reason

Risk scoring is CPU-heavy. Worker threads keep that work off the HTTP event loop and let one import use more than one CPU core.

## Trade-off

More workers do not always mean more throughput. The setting must be measured on the machine where the service runs.
