import {
  IRetryPolicy,
  RetryContext,
} from "../../domain/retry/retry-policy.interface.js";
import { ILogger, silentLogger } from "../../domain/logging/logger.interface.js";
import { MetricsMonitor } from "../metrics/metrics-monitor.js";
import { RetryPolicy } from "./retry-policy.js";

export interface BackoffRetryPolicyOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
}

export class BackoffRetryPolicy implements IRetryPolicy {
  constructor(
    private readonly logger: ILogger = silentLogger,
    private readonly options: BackoffRetryPolicyOptions = {},
  ) {}

  execute<T>(fn: () => Promise<T>, context: RetryContext): Promise<T> {
    return RetryPolicy.execute(fn, {
      maxAttempts: this.options.maxAttempts,
      initialDelayMs: this.options.initialDelayMs,
      maxDelayMs: this.options.maxDelayMs,
      signal: this.options.signal,
      onRetry: (attempt, error, delayMs) => {
        MetricsMonitor.getInstance().incrementRetryAttempts();
        this.logger.warn(
          {
            operationName: context.operationName,
            retryAttempt: attempt,
            delayMs,
            errorCode: error?.code,
            err: error,
          },
          "operation_retrying",
        );
      },
    });
  }
}
