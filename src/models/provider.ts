// §9.3: the provider contract. Only files under src/models/providers/ may
// implement this (and import a model library) — enforced by lint.

import type { Capability, FaceDetector, OcrEngine, PiiNer, QrDetector } from './capabilities';
import type { Logger } from '@/logging/schema';

export type CapabilityImpl<C extends Capability> = C extends 'face'
  ? FaceDetector
  : C extends 'ocr'
    ? OcrEngine
    : C extends 'qr'
      ? QrDetector
      : C extends 'ner'
        ? PiiNer
        : never;

export interface ModelProvider<C extends Capability> {
  id: string; // e.g. 'face/blazeface-mediapipe'
  capability: C;
  tier: 1 | 2; // 1 = light, 2 = strong
  requires: { webgpu?: boolean; minMemoryGB?: number };
  approxDownloadMB: number;
  load(ctx: {
    compute: 'webgpu' | 'wasm';
    assetUrl: (p: string) => string;
    logger: Logger;
    // M7 addition (deliberate, see docs/MILESTONES.md M7 Log): the
    // compute-host-lifetime session this load is happening under -- lets a
    // provider log its own ongoing per-call timings (e.g. NER's
    // `sanitize.ner`, §9.6) with the same session_id getModel() already uses
    // for `model.load`, without a second registry-owned logging path.
    session_id: string;
  }): Promise<CapabilityImpl<C>>;
  dispose(): Promise<void>;
}
