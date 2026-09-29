// §9.5, M12 (user decision): the automatic face model runs SCRFD and
// BlazeFace on every image and redacts every box either one finds. They
// miss different faces: SCRFD finds small and group faces (18/18 on the
// recall fixture, BlazeFace 3-4/18) but missed a 330 px close-up portrait
// that BlazeFace short-range, a close-up model, finds. A union is fail
// closed by construction: an extra box only over-redacts (§2.1). Costs one
// BlazeFace call (~15-20 ms) on top of SCRFD per new image.

import type { DetectOptions, FaceDetector } from '@/models/capabilities';
import type { ModelProvider } from '@/models/provider';
import { blazefaceMediapipe } from './blazefaceMediapipe';
import { scrfd } from './scrfd';

// Both run in parallel on the same image (bitmaps are cloned per worker,
// never transferred, so neither detaches it for the other). Either one
// failing rejects the whole call, so the image is withheld (§6.4.6) rather
// than trusting half an answer. Boxes aren't merged: redaction paints each
// one, and overlapping paint is harmless.
export function unionFaceDetectors(a: FaceDetector, b: FaceDetector): FaceDetector {
  return {
    poolSize: Math.max(a.poolSize ?? 1, b.poolSize ?? 1),
    async detect(img, options) {
      // The call waits for both, so its queue wait is the longer of the two.
      let queue = 0;
      const onQueueWait = options?.onQueueWait
        ? (ms: number) => {
            queue = Math.max(queue, ms);
          }
        : undefined;
      const inner: DetectOptions | undefined = onQueueWait ? { onQueueWait } : undefined;
      const [fromA, fromB] = await Promise.all([a.detect(img, inner), b.detect(img, inner)]);
      options?.onQueueWait?.(queue);
      return [...fromA, ...fromB];
    },
  };
}

export const scrfdPlusBlazeface: ModelProvider<'face'> = {
  id: 'face/scrfd+blazeface',
  capability: 'face',
  tier: 2,
  requires: {},
  approxDownloadMB: scrfd.approxDownloadMB + blazefaceMediapipe.approxDownloadMB,
  // No effectiveCompute: both follow the global decision (SCRFD on ORT
  // WebGPU, BlazeFace on MediaPipe's WebGL delegate -- "the GPU path").

  async load(ctx): Promise<FaceDetector> {
    // Both must load. If one fails, this load fails and the registry moves
    // on to the single-model fallbacks (models.config.ts). The pool that did
    // start is left running: there's no teardown hook yet (see dispose()),
    // and this only happens on a load failure.
    const [a, b] = await Promise.all([scrfd.load(ctx), blazefaceMediapipe.load(ctx)]);
    return unionFaceDetectors(a, b);
  },

  // Same as the other providers: getModel() is a compute-host-lifetime
  // singleton, so nothing calls this yet.
  async dispose(): Promise<void> {},
};
