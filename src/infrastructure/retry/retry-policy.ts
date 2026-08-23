export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  isRetryable?: (error: any) => boolean;
  onRetry?: (attempt: number, error: any, delayMs: number) => void;
  signal?: AbortSignal;
}

export class RetryPolicy {
  public static async execute<T>(
    fn: () => Promise<T>,
    options?: RetryOptions
  ): Promise<T> {
    const maxAttempts = options?.maxAttempts || 3;
    const initialDelayMs = options?.initialDelayMs || 100;
    const maxDelayMs = options?.maxDelayMs || 2000;
    const backoffFactor = options?.backoffFactor || 2;
    const isRetryable = options?.isRetryable || RetryPolicy.defaultIsRetryable;

    let attempt = 0;
    while (true) {
      attempt++;
      try {
        return await fn();
      } catch (error: any) {
        if (
          attempt >= maxAttempts ||
          options?.signal?.aborted ||
          !isRetryable(error)
        ) {
          throw error;
        }

        // Exponential backoff with full jitter
        const baseDelay = Math.min(
          maxDelayMs,
          initialDelayMs * Math.pow(backoffFactor, attempt - 1)
        );
        const jitteredDelay = Math.floor(baseDelay * (0.5 + Math.random() * 0.5));

        if (options?.onRetry) {
          options.onRetry(attempt, error, jitteredDelay);
        }

        await RetryPolicy.sleep(jitteredDelay, options?.signal);
      }
    }
  }

  private static sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
    return new Promise((resolve) => {
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  public static defaultIsRetryable(error: any): boolean {
    if (!error) return false;

    const message = String(error?.message || '').toLowerCase();
    const code = String(error?.code || '').toUpperCase();

    // Do NOT retry validation, duplicates, constraints, cancellation, or programming errors
    if (
      code === 'IDEMPOTENCY_KEY_REQUIRED' ||
      code === 'VALIDATION_ERROR' ||
      code === '23505' || // PostgreSQL unique violation
      code === '23503' || // PostgreSQL FK violation
      message.includes('cancelled') ||
      message.includes('validation') ||
      error instanceof SyntaxError ||
      error instanceof TypeError
    ) {
      return false;
    }

    // Retry transient network / DB connection timeouts / serialization failures
    if (
      code === '40001' || // Serialization failure / deadlock
      code === '57P01' || // Admin shutdown
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      message.includes('timeout') ||
      message.includes('connection terminated') ||
      message.includes('could not obtain lock')
    ) {
      return true;
    }

    return false;
  }
}
