// §9.6: "A shared bounded async queue (src/core/pool.ts) enforces the
// ceilings." For M7's single NER worker, the ceiling that matters is the
// micro-batch shape itself (§2.5, §7.2: up to B items or T ms, whichever
// first) -- createMicroBatcher is that primitive. M8/M9's fixed-size vision
// (N workers) and OCR (K workers) pools are a different shape (round-robin
// dispatch across several long-lived workers, not batching independent
// calls into one) and will extend this file with a second export rather
// than duplicating it, per the M7 plan.

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
