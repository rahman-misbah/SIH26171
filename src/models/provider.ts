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
  // M10 (§10.3): the compute this provider actually runs on, given the
  // global decision -- e.g. Tesseract and zxing are wasm-only, so they
  // report 'wasm' even on a WebGPU device. Omitted = follows the decision.
  // Used for model.load / SessionRecord.models, so the WebGPU-vs-WASM
  // benchmark attributes each model to the right column.
  effectiveCompute?: (compute: 'webgpu' | 'wasm') => 'webgpu' | 'wasm';
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
