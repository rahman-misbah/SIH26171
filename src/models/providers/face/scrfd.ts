// §9.3, §9.5: SCRFD-2.5G via ONNX Runtime Web -- the tier-2 face provider
// (better on small and multiple faces than BlazeFace). Listed first in
// models.config.ts, so the registry picks it automatically on a WebGPU
// device and BlazeFace everywhere else; the model settings can also pick it
// on wasm (§9.4 user override). Same worker pool, timeout and egress-guard
// logging as blazefaceMediapipe.ts.
//
// Weights: InsightFace's det_2.5g.onnx from the buffalo_m pack, which is
// licensed for non-commercial research use only (§9.5, accepted for this
// prototype in M11).

import { createWorkerPool } from '@/core/pool';
import type { Box, Bucket, FaceDetector, ImageInput } from '@/models/capabilities';
import type { ModelProvider } from '@/models/provider';
import { logEgressBlocked } from '../egressGuard';
import { startDetectWorker } from '../workerClient';
import { visionWorkerCount } from './blazefaceMediapipe';

// Same reasoning as BlazeFace's timeout: a wedged worker withholds the image
// (detector_failed) instead of hanging the observation. SCRFD at 640x640 is
// slower than BlazeFace (~100s of ms on wasm), so the headroom is still >10x.
const DETECT_TIMEOUT_MS = 10_000;

type Face = { box: Box; confidence: Bucket };

function toImage(img: ImageInput): ImageBitmap | ImageData {
  return 'bitmap' in img ? img.bitmap : img.data;
}

export const scrfd: ModelProvider<'face'> = {
  id: 'face/scrfd-2.5g',
  capability: 'face',
  tier: 2,
  // Auto-selected only on WebGPU. It runs on wasm too, but only when the
  // user picks it in settings (§9.4 override).
  requires: { webgpu: true },
  approxDownloadMB: 3.3, // det_2.5g.onnx; the ORT runtime is already bundled for NER

  async load(ctx): Promise<FaceDetector> {
    const init = {
      modelUrl: ctx.assetUrl('/models/face/scrfd_2.5g.onnx'),
      ortWasmBaseUrl: ctx.assetUrl('/ort/'),
      compute: ctx.compute,
    };
    // All N must start, as for BlazeFace: any init failure fails the load,
    // and the registry falls back to the next provider (§9.4).
    const workers = await Promise.all(
      Array.from({ length: visionWorkerCount(navigator.hardwareConcurrency || 1) }, () =>
        startDetectWorker<Face[]>(new Worker(new URL('./scrfdWorker.ts', import.meta.url), { type: 'module' }), init, {
          timeoutMs: DETECT_TIMEOUT_MS,
          name: 'face detection',
          onEgressBlocked: () => logEgressBlocked(ctx.logger, { session_id: ctx.session_id, op: 'image.face', model_id: scrfd.id }),
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

  // Nothing calls this yet (getModel() lives for the whole compute host),
  // same as the other providers.
  async dispose(): Promise<void> {},
};
