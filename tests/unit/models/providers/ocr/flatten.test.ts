// §9.5 Tesseract.js `blocks: true` output -> OcrEngine words (§9.2), and the
// §8 raw-confidence -> bucket mapping. Written before the implementation.

import { describe, expect, it } from 'vitest';
import { bucketOcrConfidence, flattenBlocks, type TessBlock } from '@/models/providers/ocr/flatten';

function w(text: string, confidence: number, x0: number, y0 = 0) {
  return { text, confidence, bbox: { x0, y0, x1: x0 + 30, y1: y0 + 12 } };
}

describe('bucketOcrConfidence', () => {
  it('maps 0-100 onto low/medium/high', () => {
    expect(bucketOcrConfidence(10)).toBe('low');
    expect(bucketOcrConfidence(59.9)).toBe('low');
    expect(bucketOcrConfidence(60)).toBe('medium');
    expect(bucketOcrConfidence(84.9)).toBe('medium');
    expect(bucketOcrConfidence(85)).toBe('high');
  });
  it('treats a non-finite score as low (fail-closed: the low-confidence rule then applies)', () => {
    expect(bucketOcrConfidence(Number.NaN)).toBe('low');
  });
});

describe('flattenBlocks', () => {
  it('numbers lines globally across blocks and paragraphs and converts boxes', () => {
    const blocks: TessBlock[] = [
      { paragraphs: [{ lines: [{ words: [w('Call', 95, 0), w('Priya', 40, 40)] }] }, { lines: [{ words: [w('x', 70, 0, 20)] }] }] },
      { paragraphs: [{ lines: [{ words: [w('Order', 90, 0, 40)] }] }] },
    ];
    expect(flattenBlocks(blocks)).toEqual([
      { text: 'Call', line: 0, confidence: 'high', box: { x: 0, y: 0, w: 30, h: 12 } },
      { text: 'Priya', line: 0, confidence: 'low', box: { x: 40, y: 0, w: 30, h: 12 } },
      { text: 'x', line: 1, confidence: 'medium', box: { x: 0, y: 20, w: 30, h: 12 } },
      { text: 'Order', line: 2, confidence: 'high', box: { x: 0, y: 40, w: 30, h: 12 } },
    ]);
  });

  it('returns no words for an image with no text', () => {
    expect(flattenBlocks([])).toEqual([]);
  });

  it('throws when blocks output is missing (a detector failure, never "no text")', () => {
    expect(() => flattenBlocks(null)).toThrow();
  });
});
