// §9.2: capability interfaces. Consumers depend only on these, never on a
// specific model library (enforced by the provider-import lint boundary, §9.3).

export type Bucket = 'low' | 'medium' | 'high';

export type Box = { x: number; y: number; w: number; h: number }; // image pixels

export type ImageInput = { bitmap: ImageBitmap } | { data: ImageData };

export interface FaceDetector {
  detect(img: ImageInput): Promise<{ box: Box; confidence: Bucket }[]>;
}

// Word-level OCR output (§9.5: Tesseract.js `blocks: true`).
export interface OcrEngine {
  read(img: ImageInput): Promise<{ text: string; box: Box; line: number; confidence: Bucket }[]>;
}

export interface QrDetector {
  detect(img: ImageInput): Promise<{ box: Box; confidence: Bucket }[]>;
}

export interface PiiNer {
  // One result list per input text — never one call per concatenated document (§2.5).
  tag(
    texts: string[]
  ): Promise<{ start: number; end: number; label: string; confidence: Bucket }[][]>;
}

export type Capability = 'face' | 'ocr' | 'qr' | 'ner';
