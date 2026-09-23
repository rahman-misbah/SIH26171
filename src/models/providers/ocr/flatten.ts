// §9.5: Tesseract.js `blocks: true` output (blocks -> paragraphs -> lines ->
// words) -> the OcrEngine's word list (§9.2), plus the §8 bucket mapping.
// Pure, so it's unit-tested without the library.

import type { Bucket } from '@/models/capabilities';

// The subset of Tesseract.js's Block type this reads (structural, so tests
// can build fixtures without the full library types).
interface TessBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface TessBlock {
  paragraphs: { lines: { words: { text: string; confidence: number; bbox: TessBbox }[] }[] }[];
}

// §8: Tesseract reports word confidence as 0-100. Edges set on the fixture
// set: clean rendered text reads at 90+; 60-85 is legible but with a
// possibly misread character; below 60 the word may be garbled, which is
// exactly when §6.4.4's extra rule (redact `@`/4+ digit words) applies.
const MEDIUM_FROM = 60;
const HIGH_FROM = 85;

export function bucketOcrConfidence(score: number): Bucket {
  if (!Number.isFinite(score)) return 'low';
  if (score >= HIGH_FROM) return 'high';
  if (score >= MEDIUM_FROM) return 'medium';
  return 'low';
}

export interface FlatWord {
  text: string;
  box: { x: number; y: number; w: number; h: number };
  line: number; // global line index across the whole image
  confidence: Bucket;
}

export function flattenBlocks(blocks: TessBlock[] | null): FlatWord[] {
  // `blocks` is null only when block output wasn't produced -- treat that as
  // a failed read, not as "the image has no text" (§2.1).
  if (!blocks) throw new Error('OCR returned no block output');
  const words: FlatWord[] = [];
  let line = 0;
  for (const block of blocks) {
    for (const paragraph of block.paragraphs) {
      for (const l of paragraph.lines) {
        for (const word of l.words) {
          const { x0, y0, x1, y1 } = word.bbox;
          words.push({ text: word.text, line, confidence: bucketOcrConfidence(word.confidence), box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } });
        }
        line++;
      }
    }
  }
  return words;
}
