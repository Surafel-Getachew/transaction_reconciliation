export interface IMetricsRecorder {
  incrementActiveImports(): void;
  decrementActiveImports(): void;
  setQueueDepth(depth: number): void;
  recordProcessedBatch(
    processed: number,
    accepted: number,
    rejected: number,
    duplicates: number,
  ): void;
  incrementRetryAttempts(): void;
  recordHttpRequest(statusCode: number): void;
}

/** Rendering is separate from recording: only the /metrics endpoint needs it. */
export interface IMetricsReporter {
  formatPrometheusMetrics(): string;
}

export const noopMetricsRecorder: IMetricsRecorder = {
  incrementActiveImports() {},
  decrementActiveImports() {},
  setQueueDepth() {},
  recordProcessedBatch() {},
  incrementRetryAttempts() {},
  recordHttpRequest() {},
};
