// Main-thread side of a model Worker that speaks the small protocol the
// face (M8) and QR (M9) workers share:
//   -> { type: 'init', ...init }          <- 'ready' | 'init-error'
//   -> { type: 'detect', id, image }      <- 'detect-result' | 'detect-error'
//   <- { type: 'egress-blocked' }         (from workerEgressGuard, any time)
// One request per worker at a time is the pool's job (core/pool.ts); this
// only matches replies to requests by id and enforces a timeout.

type Ack<R> =
  | { type: 'ready' }
  | { type: 'init-error'; message: string }
  | { type: 'detect-result'; id: number; result: R }
  | { type: 'detect-error'; id: number; message: string }
  | { type: 'egress-blocked' };

export interface DetectWorker<R> {
  detect(image: ImageBitmap | ImageData): Promise<R>;
}

export async function startDetectWorker<R>(
  worker: Worker,
  init: Record<string, unknown>,
  options: { timeoutMs: number; name: string; onEgressBlocked: () => void },
): Promise<DetectWorker<R>> {
  // Attached before init: a library can attempt a request at any point after
  // it starts loading, including during the load itself.
  worker.addEventListener('message', (event: MessageEvent<Ack<R>>) => {
    if (event.data.type === 'egress-blocked') options.onEgressBlocked();
  });

  await new Promise<void>((resolve, reject) => {
    function onMessage(event: MessageEvent<Ack<R>>): void {
      if (event.data.type === 'ready') {
        worker.removeEventListener('message', onMessage);
        resolve();
      } else if (event.data.type === 'init-error') {
        worker.removeEventListener('message', onMessage);
        reject(new Error(event.data.message));
      }
    }
    worker.addEventListener('message', onMessage);
    worker.addEventListener(
      'error',
      (event) => reject(event.error instanceof Error ? event.error : new Error(`${options.name} worker failed to start`)),
      { once: true },
    );
    worker.postMessage({ ...init, type: 'init' });
  });

  let nextId = 0;
  const pending = new Map<number, { resolve: (result: R) => void; reject: (e: unknown) => void }>();

  worker.addEventListener('message', (event: MessageEvent<Ack<R>>) => {
    const msg = event.data;
    if (msg.type === 'detect-result') {
      pending.get(msg.id)?.resolve(msg.result);
      pending.delete(msg.id);
    } else if (msg.type === 'detect-error') {
      pending.get(msg.id)?.reject(new Error(msg.message));
      pending.delete(msg.id);
    }
  });

  return {
    detect(image) {
      return new Promise<R>((resolve, reject) => {
        const id = nextId++;
        // A wedged worker must not hang the observation: the caller treats
        // the rejection as a detector failure and withholds the image.
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${options.name} timed out`));
        }, options.timeoutMs);
        pending.set(id, {
          resolve: (result) => {
            clearTimeout(timer);
            resolve(result);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        // Not transferred: structured clone gives the worker its own copy,
        // so the caller's bitmap stays usable for the other stages and for
        // redaction afterwards.
        worker.postMessage({ type: 'detect', id, image });
      });
    },
  };
}
