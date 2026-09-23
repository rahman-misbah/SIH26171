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
  const { maxBatch, maxWaitMs, run } = options;
  let queue: QueuedCall<In, Out>[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clearTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function flush(): void {
    clearTimer();
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];

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
      });
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
  run<R>(job: (worker: W) => Promise<R>): Promise<R>;
}

// §9.6: the concurrency ceiling is the worker count itself -- each worker
// runs at most one job at a time, so model instances are never asked to
// overlap work (and never duplicated beyond N). Waiting jobs start in FIFO
// order, which preserves the caller's §6.7 priority order. The wait queue
// itself isn't length-capped: its producers are already bounded (one
// observation's images, dispatched by the content script a few at a time).
export function createWorkerPool<W>(workers: W[]): WorkerPool<W> {
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
    async run<R>(job: (worker: W) => Promise<R>): Promise<R> {
      const worker = await acquire();
      try {
        return await job(worker);
      } finally {
        release(worker);
      }
    },
  };
}
