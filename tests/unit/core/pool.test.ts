import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMicroBatcher, createWorkerPool } from '@/core/pool';

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

describe('createMicroBatcher with maxInFlight + sortKey (M12: length-bucketed NER batches)', () => {
  // A run() the test resolves by hand, recording each batch it was given.
  function manualRun() {
    const batches: string[][] = [];
    const releases: (() => void)[] = [];
    const run = vi.fn(
      (batch: string[]) =>
        new Promise<string[]>((resolve) => {
          batches.push(batch);
          releases.push(() => resolve(batch.map((s) => s.toUpperCase())));
        }),
    );
    return { run, batches, release: (i: number) => releases[i]?.() };
  }

  it('keeps at most maxInFlight runs going; the rest wait in the batcher', async () => {
    const { run, batches, release } = manualRun();
    const batcher = createMicroBatcher({ maxBatch: 2, maxWaitMs: 10, maxInFlight: 1, run });
    const all = ['a', 'b', 'c', 'd', 'e'].map((s) => batcher.submit(s));
    await vi.advanceTimersByTimeAsync(50);
    expect(batches).toEqual([['a', 'b']]);
    release(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(batches.length).toBe(2);
    release(1);
    await vi.advanceTimersByTimeAsync(0);
    release(2);
    expect(await Promise.all(all)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(batches.flat().sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('batches the oldest waiting item with the ones closest to it in sortKey', async () => {
    const { run, batches, release } = manualRun();
    const batcher = createMicroBatcher({ maxBatch: 3, maxWaitMs: 10, maxInFlight: 1, sortKey: (s: string) => s.length, run });
    // The first three go out at once (maxBatch reached, nothing in flight).
    const first = ['x', 'y', 'z'].map((s) => batcher.submit(s));
    const waiting = ['long-long-1', 'a', 'long-long-2', 'b', 'long-long-3', 'c'].map((s) => batcher.submit(s));
    release(0);
    await vi.advanceTimersByTimeAsync(0);
    // Oldest waiting is 'long-long-1': it's joined by the other long ones,
    // not by the short items between them.
    expect(batches[1]).toEqual(['long-long-1', 'long-long-2', 'long-long-3']);
    release(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(batches[2]).toEqual(['a', 'b', 'c']);
    release(2);
    expect(await Promise.all([...first, ...waiting])).toEqual(['X', 'Y', 'Z', 'LONG-LONG-1', 'A', 'LONG-LONG-2', 'B', 'LONG-LONG-3', 'C']);
  });

  it('frees its slot when a run rejects, and keeps going', async () => {
    let calls = 0;
    const run = vi.fn(async (batch: number[]) => {
      calls += 1;
      if (calls === 1) throw new Error('worker crashed');
      return batch.map((n) => n * 10);
    });
    const batcher = createMicroBatcher({ maxBatch: 1, maxWaitMs: 10, maxInFlight: 1, run });
    const p1 = batcher.submit(1);
    const p2 = batcher.submit(2);
    await expect(p1).rejects.toThrow('worker crashed');
    expect(await p2).toBe(20);
  });
});

describe('createWorkerPool (§9.6: bounded pool of long-lived workers)', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('refuses an empty worker list', () => {
    expect(() => createWorkerPool([])).toThrow();
  });

  it('never runs more jobs at once than there are workers', async () => {
    const pool = createWorkerPool(['w1', 'w2']);
    let active = 0;
    let peak = 0;
    const gates = [deferred<void>(), deferred<void>(), deferred<void>(), deferred<void>()];
    const jobs = gates.map((gate) =>
      pool.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await gate.promise;
        active--;
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(active).toBe(2);
    for (const gate of gates) gate.resolve();
    await Promise.all(jobs);
    expect(peak).toBe(2);
  });

  it('starts queued jobs in FIFO order as workers free up', async () => {
    const pool = createWorkerPool(['only']);
    const started: number[] = [];
    const gate = deferred<void>();
    const first = pool.run(async () => {
      started.push(1);
      await gate.promise;
    });
    const second = pool.run(async () => {
      started.push(2);
    });
    const third = pool.run(async () => {
      started.push(3);
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([1]);
    gate.resolve();
    await Promise.all([first, second, third]);
    expect(started).toEqual([1, 2, 3]);
  });

  it('hands each job a worker, never the same busy worker to two jobs', async () => {
    const pool = createWorkerPool(['a', 'b']);
    const gate = deferred<void>();
    const seen: string[] = [];
    const jobs = [0, 1].map(() =>
      pool.run(async (worker) => {
        seen.push(worker);
        await gate.promise;
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(new Set(seen)).toEqual(new Set(['a', 'b']));
    gate.resolve();
    await Promise.all(jobs);
  });

  it('a failing job rejects only its own caller and frees its worker', async () => {
    const pool = createWorkerPool(['only']);
    const failing = pool.run(async () => {
      throw new Error('boom');
    });
    const next = pool.run(async (worker) => `${worker}-ok`);
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('only-ok');
  });

  // M10 (§9.6 "tune N from logged timings"): queue wait is reported
  // separately from the job's own time, so pool size can be tuned.
  it('reports ~0 queue wait when a worker is free', async () => {
    const t = 100;
    const pool = createWorkerPool(['only'], { now: () => t });
    const waits: number[] = [];
    await pool.run(async () => {}, (ms) => waits.push(ms));
    expect(waits).toEqual([0]);
  });

  it('reports how long a job waited for a busy worker', async () => {
    let t = 0;
    const pool = createWorkerPool(['only'], { now: () => t });
    const gate = deferred<void>();
    const first = pool.run(() => gate.promise);
    const waits: number[] = [];
    const second = pool.run(async () => {}, (ms) => waits.push(ms));
    await vi.advanceTimersByTimeAsync(0);
    t = 250;
    gate.resolve();
    await Promise.all([first, second]);
    expect(waits).toEqual([250]);
  });

  it('a throwing onQueueWait callback never breaks the job', async () => {
    const pool = createWorkerPool(['only']);
    const result = pool.run(async () => 'ok', () => {
      throw new Error('logger down');
    });
    await expect(result).resolves.toBe('ok');
  });
});
