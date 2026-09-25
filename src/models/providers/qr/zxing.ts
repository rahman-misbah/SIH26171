// §9.3, §9.5: zxing-wasm `readBarcodes` -- the tier-1 QR/barcode provider
// (non-ML). Owns its own pool of N workers, N = the vision worker count
// (§9.6), separate from the face pool (decided in the M9 plan: §9.6 has one
// vision worker hold face + QR; separate pools keep MediaPipe and zxing out
// of each other's crash radius, and let face and QR run in parallel on the
// same image). Only boxes come back from the worker -- decoded content never
// leaves it (see worker.ts).

import { createWorkerPool } from '@/core/pool';
import type { Box, Bucket, ImageInput, QrDetector } from '@/models/capabilities';
import type { ModelProvider } from '@/models/provider';
import { logEgressBlocked } from '../egressGuard';
import { visionWorkerCount } from '../face/blazefaceMediapipe';
import { startDetectWorker } from '../workerClient';

// zxing on a ~1000 px image runs in tens of ms with tryHarder; 10s (as for
// face) only catches a wedged worker, which then withholds the image.
const DETECT_TIMEOUT_MS = 10_000;

type Code = { box: Box; confidence: Bucket };

function toImage(img: ImageInput): ImageBitmap | ImageData {
  return 'bitmap' in img ? img.bitmap : img.data;
}

export const zxingQr: ModelProvider<'qr'> = {
  id: 'qr/zxing-wasm',
  capability: 'qr',
  tier: 1,
  requires: {}, // wasm everywhere
  approxDownloadMB: 1, // ~1 MB reader wasm, no model weights
  effectiveCompute: () => 'wasm', // §10.3: no GPU path in zxing

  async load(ctx): Promise<QrDetector> {
    const init = { wasmUrl: ctx.assetUrl('/zxing/zxing_reader.wasm') };
    // All N must start (same reasoning as the face pool).
    const workers = await Promise.all(
      Array.from({ length: visionWorkerCount(navigator.hardwareConcurrency || 1) }, () =>
        startDetectWorker<Code[]>(new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }), init, {
          timeoutMs: DETECT_TIMEOUT_MS,
          name: 'QR detection',
          onEgressBlocked: () => logEgressBlocked(ctx.logger, { session_id: ctx.session_id, op: 'image.qr', model_id: zxingQr.id }),
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

  // No session-end model teardown exists yet (same as the other providers).
  async dispose(): Promise<void> {},
};
