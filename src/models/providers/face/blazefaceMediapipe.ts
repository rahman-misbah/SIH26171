// §9.3, §9.5: BlazeFace short-range via MediaPipe Tasks Vision -- the tier-1
// face provider. Owns the §9.6 vision-worker pool: N long-lived workers, each
// with its own FaceDetector instance, one detection at a time per worker.
// (§9.6 says each vision worker "holds face + QR providers"; with one worker
// set per provider, this provider owns its workers and M9 decides where the
// QR provider runs -- agreed in the M8 plan.)

import { createWorkerPool } from '@/core/pool';
import type { Box, Bucket, FaceDetector, ImageInput } from '@/models/capabilities';
import type { ModelProvider } from '@/models/provider';
import { logEgressBlocked } from '../egressGuard';

// §9.6: N = clamp(hardwareConcurrency - 2, 1, 3) -- leave two cores for the
// page and the rest of the compute host; more than 3 instances just costs
// memory (each holds its own wasm heap + model).
export function visionWorkerCount(hardwareConcurrency: number): number {
  return Math.min(3, Math.max(1, hardwareConcurrency - 2));
}

// A detection that hasn't answered in this long is treated as failed, so a
// wedged worker can't hang the observation forever -- the image is then
// withheld as detector_failed (§6.4.6), never passed through. BlazeFace
// short-range runs in tens of ms on wasm; 10s is two orders of magnitude of
// headroom for a cold, contended machine.
const DETECT_TIMEOUT_MS = 10_000;

type Face = { box: Box; confidence: Bucket };
type WorkerAck =
  | { type: 'ready' }
  | { type: 'init-error'; message: string }
  | { type: 'detect-result'; id: number; faces: Face[] }
  | { type: 'detect-error'; id: number; message: string }
  | { type: 'egress-blocked' };

interface VisionWorker {
  detect(image: ImageBitmap | ImageData): Promise<Face[]>;
}

async function startWorker(
  init: { wasmBaseUrl: string; modelUrl: string; compute: 'webgpu' | 'wasm' },
  onEgressBlocked: () => void,
): Promise<VisionWorker> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  // Attached before init: MediaPipe can attempt a request at any point after
  // its task is created, including during the load itself.
  worker.addEventListener('message', (event: MessageEvent<WorkerAck>) => {
    if (event.data.type === 'egress-blocked') onEgressBlocked();
  });

  await new Promise<void>((resolve, reject) => {
    function onMessage(event: MessageEvent<WorkerAck>): void {
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
      (event) => reject(event.error instanceof Error ? event.error : new Error('face worker failed to start')),
      { once: true },
    );
    worker.postMessage({ type: 'init', ...init });
  });

  let nextId = 0;
  const pending = new Map<number, { resolve: (faces: Face[]) => void; reject: (e: unknown) => void }>();

  worker.addEventListener('message', (event: MessageEvent<WorkerAck>) => {
    const msg = event.data;
    if (msg.type === 'detect-result') {
      pending.get(msg.id)?.resolve(msg.faces);
      pending.delete(msg.id);
    } else if (msg.type === 'detect-error') {
      pending.get(msg.id)?.reject(new Error(msg.message));
      pending.delete(msg.id);
    }
  });

  return {
    detect(image) {
      return new Promise<Face[]>((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('face detection timed out'));
        }, DETECT_TIMEOUT_MS);
        pending.set(id, {
          resolve: (faces) => {
            clearTimeout(timer);
            resolve(faces);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        // Not transferred: structured clone gives the worker its own copy,
        // so the caller's bitmap stays usable for redaction afterwards.
        worker.postMessage({ type: 'detect', id, image });
      });
    },
  };
}

function toImage(img: ImageInput): ImageBitmap | ImageData {
  return 'bitmap' in img ? img.bitmap : img.data;
}

export const blazefaceMediapipe: ModelProvider<'face'> = {
  id: 'face/blazeface-mediapipe',
  capability: 'face',
  tier: 1,
  requires: {}, // CPU (wasm) everywhere; WebGL delegate when a GPU is available
  approxDownloadMB: 12, // ~0.23 MB model + ~12 MB MediaPipe vision wasm

  async load(ctx): Promise<FaceDetector> {
    const init = {
      wasmBaseUrl: ctx.assetUrl('/mediapipe'),
      modelUrl: ctx.assetUrl('/models/face/blaze_face_short_range.tflite'),
      compute: ctx.compute,
    };
    // All N must start: a partially-started pool would silently run with
    // less capacity than the logs say, so any init failure fails the load
    // (-> the registry's fail-closed fallback: every image withheld).
    const workers = await Promise.all(
      Array.from({ length: visionWorkerCount(navigator.hardwareConcurrency || 1) }, () =>
        startWorker(init, () => logEgressBlocked(ctx.logger, { session_id: ctx.session_id, op: 'image.face', model_id: blazefaceMediapipe.id })),
      ),
    );
    const pool = createWorkerPool(workers);

    return {
      detect(img) {
        return pool.run((worker) => worker.detect(toImage(img)));
      },
    };
  },

  // Same as the NER provider: no session-end model-teardown concept exists
  // yet (getModel() is a compute-host-lifetime singleton), so nothing calls
  // this -- a documented no-op rather than plumbing an unused handle.
  async dispose(): Promise<void> {},
};
