// §9.6: "A shared bounded async queue (src/core/pool.ts) enforces the
// ceilings." Two primitives, for two shapes of work:
// - createMicroBatcher (M7): coalesces independent calls into one batched
//   inference call on a single worker -- the NER shape (§2.5, §7.2: up to B
//   items or T ms, whichever first).
// - createWorkerPool (M8): dispatches one job at a time to each of N
//   long-lived workers, queueing the rest -- the vision (N workers) and OCR
//   (K workers) shape.

export interface MicroBatcherOptions<In, Out> {
  maxBatch: number;
  maxWaitMs: number;
  // Runs exactly once per flush, given the batch's inputs in call order;
  // must return one output per input, same order (§2.5: one batched
  // inference, results demultiplexed back to callers).
  run: (batch: In[]) => Promise<Out[]>;
  // M12: at most this many runs at once (default: unlimited). Items that
  // arrive while the limit is reached wait here, which is what gives
  // `sortKey` a choice of items to group.
  maxInFlight?: number;
  // M12: when set, each batch is the oldest waiting item plus the waiting
  // items whose key is closest to its key. For NER the key is text length:
  // a batch is padded to its longest sequence, so mixing a 5-character link
  // with a 2,000-character paragraph made the short one cost as much as the
  // long one. Anchoring on the oldest item means nothing waits forever.
  sortKey?: (input: In) => number;
}

export interface MicroBatcher<In, Out> {
  // Resolves once this call's item has been included in a flushed batch and
  // the corresponding output is back. A batch element's own failure aside,
  // if `run` itself rejects, every caller in that batch rejects with the
  // same error (nothing is passed through as if it succeeded).
  submit(input: In): Promise<Out>;
}

interface QueuedCall<In, Out> {
  input: In;
  resolve: (out: Out) => void;
  reject: (err: unknown) => void;
}

export function createMicroBatcher<In, Out>(options: MicroBatcherOptions<In, Out>): MicroBatcher<In, Out> {
  const { maxBatch, maxWaitMs, run, sortKey } = options;
  const maxInFlight = options.maxInFlight ?? Number.POSITIVE_INFINITY;
  let queue: QueuedCall<In, Out>[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = 0;

  function clearTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  // Takes the next batch off the queue: in arrival order, or (with sortKey)
  // the oldest item plus the ones nearest to it by key, in arrival order.
  function takeBatch(): QueuedCall<In, Out>[] {
    if (!sortKey || queue.length <= maxBatch) {
      const batch = queue.slice(0, maxBatch);
      queue = queue.slice(maxBatch);
      return batch;
    }
    const anchorKey = sortKey(queue[0]!.input);
    const chosen = new Set(
      queue
        .map((call, index) => ({ index, distance: index === 0 ? -1 : Math.abs(sortKey(call.input) - anchorKey) }))
        .sort((a, b) => a.distance - b.distance || a.index - b.index)
        .slice(0, maxBatch)
        .map((c) => c.index),
    );
    const batch = queue.filter((_, i) => chosen.has(i));
    queue = queue.filter((_, i) => !chosen.has(i));
    return batch;
  }

  function flush(): void {
    clearTimer();
    if (queue.length === 0 || inFlight >= maxInFlight) return;
    const batch = takeBatch();
    inFlight += 1;

    run(batch.map((c) => c.input))
      .then((results) => {
        batch.forEach((call, i) => {
          const result = results[i];
          if (result === undefined && i >= results.length) {
            call.reject(new Error('micro-batch run() returned fewer results than inputs'));
          } else {
            call.resolve(result as Out);
          }
        });
      })
      .catch((error: unknown) => {
        for (const call of batch) call.reject(error);
      })
      .finally(() => {
        inFlight -= 1;
        // Whatever queued up during the run goes next, without waiting for
        // the timer: the worker is idle now.
        flush();
      });

    // Unlimited in-flight (the M7 behaviour): a full queue flushes again now.
    if (queue.length >= maxBatch) flush();
    else if (queue.length > 0) timer ??= setTimeout(flush, maxWaitMs);
  }

  function submit(input: In): Promise<Out> {
    return new Promise<Out>((resolve, reject) => {
      queue.push({ input, resolve, reject });
      if (queue.length >= maxBatch) {
        flush();
        return;
      }
      timer ??= setTimeout(flush, maxWaitMs);
    });
  }

  return { submit };
}

export interface WorkerPool<W> {
  readonly size: number;
  // Runs `job` on the next free worker. Resolves/rejects with the job's own
  // result -- a failing job never affects other callers, and its worker is
  // returned to the pool either way.
  // `onQueueWait` (M10) gets how long the job waited for a free worker, in
  // ms, just before it starts -- logged as `queue_ms` so §9.6's pool sizes
  // can be tuned from queueing vs. inference time rather than their sum.
  run<R>(job: (worker: W) => Promise<R>, onQueueWait?: (ms: number) => void): Promise<R>;
}

export interface WorkerPoolOptions {
  now?: () => number; // injectable clock for tests; defaults to performance.now
}

// §9.6: the concurrency ceiling is the worker count itself -- each worker
// runs at most one job at a time, so model instances are never asked to
// overlap work (and never duplicated beyond N). Waiting jobs start in FIFO
// order, which preserves the caller's §6.7 priority order. The wait queue
// itself isn't length-capped: its producers are already bounded (one
// observation's images, dispatched by the content script a few at a time).
export function createWorkerPool<W>(workers: W[], options: WorkerPoolOptions = {}): WorkerPool<W> {
  const now = options.now ?? (() => performance.now());
  if (workers.length === 0) throw new Error('createWorkerPool needs at least one worker');
  const idle = [...workers];
  const waiting: ((worker: W) => void)[] = [];

  function acquire(): Promise<W> {
    const worker = idle.pop();
    if (worker !== undefined) return Promise.resolve(worker);
    return new Promise<W>((resolve) => waiting.push(resolve));
  }

  function release(worker: W): void {
    const next = waiting.shift();
    if (next) next(worker);
    else idle.push(worker);
  }

  return {
    size: workers.length,
    async run<R>(job: (worker: W) => Promise<R>, onQueueWait?: (ms: number) => void): Promise<R> {
      const queuedAt = now();
      const worker = await acquire();
      try {
        // A metrics callback must never fail the job it measures.
        try {
          onQueueWait?.(now() - queuedAt);
        } catch {
          // ignored
        }
        return await job(worker);
      } finally {
        release(worker);
      }
    },
  };
}
