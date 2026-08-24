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
}

export const noopMetricsRecorder: IMetricsRecorder = {
  incrementActiveImports() {},
  decrementActiveImports() {},
  setQueueDepth() {},
  recordProcessedBatch() {},
  incrementRetryAttempts() {},
};
