import { describe, expect, it } from 'vitest';
import { encodeBmp24 } from '@/models/providers/ocr/bmp';

// 2x2 RGBA, row-major top-down: red, green / blue, transparent.
const PIXELS = new Uint8ClampedArray([
  255, 0, 0, 255, /**/ 0, 255, 0, 255,
  0, 0, 255, 255, /**/ 0, 0, 0, 0,
]);

function u32(b: Uint8Array, at: number): number {
  return new DataView(b.buffer, b.byteOffset).getUint32(at, true);
}
function i32(b: Uint8Array, at: number): number {
  return new DataView(b.buffer, b.byteOffset).getInt32(at, true);
}

describe('encodeBmp24 (M10: OCR input without a canvas encode)', () => {
  const bmp = encodeBmp24(PIXELS, 2, 2);

  it('writes a BITMAPINFOHEADER BMP of the right size', () => {
    expect(String.fromCharCode(bmp[0]!, bmp[1]!)).toBe('BM');
    // 54-byte header + 2 rows x (2 px x 3 bytes, padded to 8).
    expect(bmp.length).toBe(54 + 2 * 8);
    expect(u32(bmp, 2)).toBe(bmp.length);
    expect(u32(bmp, 10)).toBe(54); // pixel data offset
    expect(u32(bmp, 14)).toBe(40); // header size
    expect(i32(bmp, 18)).toBe(2); // width
    expect(i32(bmp, 22)).toBe(2); // height > 0: bottom-up rows
    expect(new DataView(bmp.buffer).getUint16(28, true)).toBe(24); // bits per pixel
  });

  it('stores rows bottom-up as BGR with 4-byte row padding', () => {
    const bottomRow = Array.from(bmp.subarray(54, 62));
    const topRow = Array.from(bmp.subarray(62, 70));
    // Bottom row = source row 1: blue, then transparent (blended onto white).
    expect(bottomRow).toEqual([255, 0, 0, 255, 255, 255, 0, 0]);
    // Top row = source row 0: red, green.
    expect(topRow).toEqual([0, 0, 255, 0, 255, 0, 0, 0]);
  });

  it('blends partial alpha onto white, so dark text on a transparent background stays readable', () => {
    const half = encodeBmp24(new Uint8ClampedArray([0, 0, 0, 128]), 1, 1);
    // 0 * 128/255 + 255 * (1 - 128/255) = 127
    expect(Array.from(half.subarray(54, 57))).toEqual([127, 127, 127]);
  });

  it('rejects a pixel buffer that does not match the dimensions', () => {
    expect(() => encodeBmp24(new Uint8ClampedArray(4), 2, 2)).toThrow();
  });
});
