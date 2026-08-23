import { describe, expect, it } from 'vitest';
import { ImportJobQueue } from '../../src/application/queue/import-job-queue.js';

describe('ImportJobQueue', () => {
  it('bounds reservations and runs only the configured number of jobs', async () => {
    let release!: () => void;
    let started = 0;
    const queue = new ImportJobQueue(async () => {
      started++;
      await new Promise<void>((resolve) => { release = resolve; });
    }, 1, 1);

    const first = queue.reserve();
    expect(first).not.toBeNull();
    expect(queue.reserve()).toBeNull();
    first!.enqueue({ importId: 'one', filePath: '/tmp/one', providerId: 'provider' });

    await new Promise((resolve) => setImmediate(resolve));
    expect(started).toBe(1);
    expect(queue.depth).toBe(0);

    release();
    await queue.drain();
  });
});
