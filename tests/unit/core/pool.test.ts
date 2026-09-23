import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMicroBatcher } from '@/core/pool';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createMicroBatcher', () => {
  it('flushes at maxBatch without waiting for the timer', async () => {
    const run = vi.fn(async (batch: number[]) => batch.map((n) => n * 2));
    const batcher = createMicroBatcher({ maxBatch: 2, maxWaitMs: 1000, run });

    const results = await Promise.all([batcher.submit(1), batcher.submit(2)]);

    expect(results).toEqual([2, 4]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith([1, 2]);
  });

  it('flushes on the timer when maxBatch is never reached', async () => {
    const run = vi.fn(async (batch: number[]) => batch.map((n) => n * 2));
    const batcher = createMicroBatcher({ maxBatch: 16, maxWaitMs: 10, run });

    const promise = batcher.submit(5);
    await vi.advanceTimersByTimeAsync(10);

    expect(await promise).toBe(10);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith([5]);
  });

  it('demultiplexes results back to each caller in call order', async () => {
    const run = vi.fn(async (batch: string[]) => batch.map((s) => s.toUpperCase()));
    const batcher = createMicroBatcher({ maxBatch: 3, maxWaitMs: 1000, run });

    const [a, b, c] = await Promise.all([batcher.submit('a'), batcher.submit('b'), batcher.submit('c')]);

    expect([a, b, c]).toEqual(['A', 'B', 'C']);
  });

  it('rejects every caller in a batch when run() rejects, none passed through as ok', async () => {
    const run = vi.fn(async () => {
      throw new Error('worker crashed');
    });
    const batcher = createMicroBatcher({ maxBatch: 2, maxWaitMs: 1000, run });

    const p1 = batcher.submit(1);
    const p2 = batcher.submit(2);

    await expect(p1).rejects.toThrow('worker crashed');
    await expect(p2).rejects.toThrow('worker crashed');
  });

  it('starts a fresh batch after a flush', async () => {
    const run = vi.fn(async (batch: number[]) => batch.map((n) => n + 1));
    const batcher = createMicroBatcher({ maxBatch: 1, maxWaitMs: 1000, run });

    expect(await batcher.submit(1)).toBe(2);
    expect(await batcher.submit(2)).toBe(3);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
