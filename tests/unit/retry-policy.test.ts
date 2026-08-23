import { describe, it, expect, vi } from 'vitest';
import { RetryPolicy } from '../../src/infrastructure/retry/retry-policy.js';

describe('RetryPolicy', () => {
  it('should return result on first attempt if successful', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const res = await RetryPolicy.execute(fn);
    expect(res).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry retryable error and succeed on second attempt', async () => {
    let count = 0;
    const fn = vi.fn().mockImplementation(async () => {
      count++;
      if (count === 1) {
        const err: any = new Error('connection terminated');
        err.code = 'ECONNRESET';
        throw err;
      }
      return 'recovered';
    });

    const onRetry = vi.fn();
    const res = await RetryPolicy.execute(fn, {
      maxAttempts: 3,
      initialDelayMs: 10,
      onRetry,
    });

    expect(res).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('should not retry non-retryable error (e.g. validation / duplicate constraint)', async () => {
    const fn = vi.fn().mockImplementation(async () => {
      const err: any = new Error('unique constraint violation');
      err.code = '23505';
      throw err;
    });

    await expect(RetryPolicy.execute(fn, { maxAttempts: 3 })).rejects.toThrow(
      'unique constraint violation'
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
