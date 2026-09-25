// §9.2: capability interfaces. Consumers depend only on these, never on a
// specific model library (enforced by the provider-import lint boundary, §9.3).

export type Bucket = 'low' | 'medium' | 'high';

export type Box = { x: number; y: number; w: number; h: number }; // image pixels

export type ImageInput = { bitmap: ImageBitmap } | { data: ImageData };

// M10: optional per-call hooks for pooled detectors. `onQueueWait` receives
// how long the call waited for a free worker (ms), so the caller can log it
// as `queue_ms` separately from inference time (§9.6 tuning).
export interface DetectOptions {
  onQueueWait?: (ms: number) => void;
}

// `poolSize` (M10): how many workers back a pooled detector, so warm start
// (core/warmStart.ts) can warm each one. Omitted = one.
export interface FaceDetector {
  readonly poolSize?: number;
  detect(img: ImageInput, options?: DetectOptions): Promise<{ box: Box; confidence: Bucket }[]>;
}

// Word-level OCR output (§9.5: Tesseract.js `blocks: true`).
export interface OcrEngine {
  readonly poolSize?: number;
  read(img: ImageInput, options?: DetectOptions): Promise<{ text: string; box: Box; line: number; confidence: Bucket }[]>;
}

export interface QrDetector {
  readonly poolSize?: number;
  detect(img: ImageInput, options?: DetectOptions): Promise<{ box: Box; confidence: Bucket }[]>;
}

export interface PiiNer {
  // One result list per input text — never one call per concatenated document (§2.5).
  tag(
    texts: string[]
  ): Promise<{ start: number; end: number; label: string; confidence: Bucket }[][]>;
}

export type Capability = 'face' | 'ocr' | 'qr' | 'ner';
