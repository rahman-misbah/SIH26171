// §15 warm start: load every model and run a warm-up inference as soon as
// the compute host starts, so the first real observation doesn't pay for
// wasm compilation, weight loading and first-run JIT/shader setup.
//
// Pooled detectors get one warm-up call *per worker*, all at once: each pool
// hands concurrent jobs to different idle workers (core/pool.ts), so N
// simultaneous calls reach all N workers.
//
// Warm-up inputs are synthetic (a blank image, a fixed non-PII string) --
// never page content. Nothing here can fail the host: every failure is
// logged as a failed `model.warmup` and the lazy load path stays in place.

import type { RuntimeLogger } from '@/logging';
import type { Capability, ImageInput } from '@/models/capabilities';
import type { CapabilityImpl } from '@/models/provider';

// Blank-image side for warm-up calls: big enough for every detector to run
// its full pipeline (BlazeFace's input is 128x128 after resize anyway),
// small enough to cost only a few ms per call.
export const WARMUP_IMAGE_SIDE = 64;

const NER_WARMUP_TEXT = 'warm up';

export interface WarmStartDeps {
  getModel: <C extends Capability>(capability: C) => Promise<CapabilityImpl<C>>;
  logger: RuntimeLogger;
  session_id: string;
  // A fresh blank image per call: detectors may transfer their input to a
  // worker, so concurrent calls must never share one.
  blankImage: () => ImageInput;
}

function times<T>(n: number, fn: () => Promise<T>): Promise<T[]> {
  return Promise.all(Array.from({ length: Math.max(1, n) }, fn));
}

async function warmOne(capability: Capability, deps: WarmStartDeps): Promise<void> {
  const counts = { units: 0 };
  await deps.logger.timed('model.warmup', { session_id: deps.session_id, counts }, async () => {
    switch (capability) {
      case 'face':
      case 'qr': {
        const detector = await deps.getModel(capability);
        counts.units = detector.poolSize ?? 1;
        await times(counts.units, () => detector.detect(deps.blankImage()));
        return;
      }
      case 'ocr': {
        const engine = await deps.getModel('ocr');
        counts.units = engine.poolSize ?? 1;
        await times(counts.units, () => engine.read(deps.blankImage()));
        return;
      }
      case 'ner': {
        const ner = await deps.getModel('ner');
        counts.units = 1;
        await ner.tag([NER_WARMUP_TEXT]);
        return;
      }
    }
  });
}

// Staged: NER first (every observation needs it; image models only matter
// on pages with images), then the three image models together. Warming all
// four at once saturated the CPU for ~10 s after startup and made a task
// started in that window slower than no warm start at all (measured in M10).
// Each failure is already logged by timed(), so it's swallowed here.
export async function warmStart(deps: WarmStartDeps): Promise<void> {
  await warmOne('ner', deps).catch(() => undefined);
  const imageModels: Capability[] = ['face', 'ocr', 'qr'];
  await Promise.all(imageModels.map((c) => warmOne(c, deps).catch(() => undefined)));
}
