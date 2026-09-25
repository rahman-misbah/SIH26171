// §9.3, §9.5: BlazeFace short-range via MediaPipe Tasks Vision -- the tier-1
// face provider. Owns the §9.6 vision-worker pool: N long-lived workers, each
// with its own FaceDetector instance, one detection at a time per worker.
// (§9.6 says each vision worker "holds face + QR providers"; instead each
// provider owns its own pool -- QR runs in ../qr/zxing.ts's, decided in the
// M9 plan -- so MediaPipe and zxing never share a worker's crash radius.)

import { createWorkerPool } from '@/core/pool';
import type { Box, Bucket, FaceDetector, ImageInput } from '@/models/capabilities';
import type { ModelProvider } from '@/models/provider';
import { logEgressBlocked } from '../egressGuard';
import { startDetectWorker } from '../workerClient';

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

function toImage(img: ImageInput): ImageBitmap | ImageData {
  return 'bitmap' in img ? img.bitmap : img.data;
}

export const blazefaceMediapipe: ModelProvider<'face'> = {
  id: 'face/blazeface-mediapipe',
  capability: 'face',
  tier: 1,
  requires: {}, // CPU (wasm) everywhere; WebGL delegate when a GPU is available
  approxDownloadMB: 12, // ~0.23 MB model + ~12 MB MediaPipe vision wasm
  // No effectiveCompute: follows the global decision. Note MediaPipe's GPU
  // delegate is WebGL, not WebGPU -- so 'webgpu' logged for this model means
  // "the GPU path" (docs/BENCHMARKS.md says so next to the table).

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
        startDetectWorker<Face[]>(new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }), init, {
          timeoutMs: DETECT_TIMEOUT_MS,
          name: 'face detection',
          onEgressBlocked: () =>
            logEgressBlocked(ctx.logger, { session_id: ctx.session_id, op: 'image.face', model_id: blazefaceMediapipe.id }),
        }),
      ),
    );
    const pool = createWorkerPool(workers);

    return {
      poolSize: pool.size,
      detect(img, options) {
        return pool.run((worker) => worker.detect(toImage(img)), options?.onQueueWait);
      },
    };
  },

  // Same as the NER provider: no session-end model-teardown concept exists
  // yet (getModel() is a compute-host-lifetime singleton), so nothing calls
  // this -- a documented no-op rather than plumbing an unused handle.
  async dispose(): Promise<void> {},
};
