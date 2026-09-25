// M10 (§15 latency): main-thread side of encodeWorker.ts. One long-lived
// worker, created on first use; encodes are short (tens of ms), so one is
// enough and jobs simply queue behind each other (§9.6: bounded, no
// unbounded spawning).
//
// Fallback: if the worker can't start or a job fails, the same pixels are
// encoded in place with convertToBlob(). They are already redacted, so this
// only costs time (the ~1 s idle-deadline wait), never privacy.

import { createWorkerPool, type WorkerPool } from '@/core/pool';

// A worker that hasn't answered in this long is treated as failed and the
// encode falls back to the in-place path. Measured encodes are ~10-30 ms;
// 5 s allows for a large image on a slow, contended machine.
const ENCODE_TIMEOUT_MS = 5_000;

type EncodeReply = { id: number; blob: Blob } | { id: number; error: true };

interface EncodeClient {
  encode(bitmap: ImageBitmap, quality: number): Promise<Blob>;
}

function startClient(): EncodeClient {
  const worker = new Worker(new URL('./encodeWorker.ts', import.meta.url), { type: 'module' });
  let nextId = 0;
  const pending = new Map<number, { resolve: (blob: Blob) => void; reject: (e: Error) => void }>();
  worker.addEventListener('message', (event: MessageEvent<EncodeReply>) => {
    const reply = event.data;
    const call = pending.get(reply.id);
    if (!call) return;
    pending.delete(reply.id);
    if ('blob' in reply) call.resolve(reply.blob);
    else call.reject(new Error('encode failed'));
  });
  // A crashed worker fails everything in flight; the pool is rebuilt on the
  // next call (see getPool).
  worker.addEventListener('error', () => {
    for (const call of pending.values()) call.reject(new Error('encode worker failed'));
    pending.clear();
    pool = undefined;
  });
  return {
    encode(bitmap, quality) {
      return new Promise<Blob>((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('encode timed out'));
        }, ENCODE_TIMEOUT_MS);
        pending.set(id, {
          resolve: (blob) => {
            clearTimeout(timer);
            resolve(blob);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        // Transferred, not copied: the caller's bitmap is detached after this.
        worker.postMessage({ id, bitmap, quality }, [bitmap]);
      });
    },
  };
}

let pool: WorkerPool<EncodeClient> | undefined;

function getPool(): WorkerPool<EncodeClient> | undefined {
  if (typeof Worker === 'undefined') return undefined;
  try {
    pool ??= createWorkerPool([startClient()]);
  } catch {
    return undefined;
  }
  return pool;
}

async function encodeInPlace(bitmap: ImageBitmap, quality: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}

// Encodes `canvas` (already redacted) as JPEG. Consumes the canvas's pixels.
export async function encodeJpeg(canvas: OffscreenCanvas, quality: number): Promise<Blob> {
  const workers = getPool();
  if (workers) {
    // A copy for the worker, so the original stays usable for the fallback.
    const forWorker = await createImageBitmap(canvas);
    try {
      return await workers.run((client) => client.encode(forWorker, quality));
    } catch {
      forWorker.close(); // no-op if it was already transferred
    }
  }
  const local = canvas.transferToImageBitmap();
  try {
    return await encodeInPlace(local, quality);
  } finally {
    local.close();
  }
}
