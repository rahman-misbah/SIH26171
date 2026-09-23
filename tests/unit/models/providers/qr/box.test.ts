// zxing-wasm reports a code's four corners (possibly rotated); redaction
// needs an axis-aligned box that covers all of them. Written before the
// implementation.

import { describe, expect, it } from 'vitest';
import { positionToBox } from '@/models/providers/qr/box';

describe('positionToBox', () => {
  it('covers an upright code exactly', () => {
    expect(
      positionToBox({ topLeft: { x: 10, y: 20 }, topRight: { x: 110, y: 20 }, bottomRight: { x: 110, y: 120 }, bottomLeft: { x: 10, y: 120 } }),
    ).toEqual({ x: 10, y: 20, w: 100, h: 100 });
  });

  it('covers every corner of a rotated code', () => {
    expect(
      positionToBox({ topLeft: { x: 50, y: 0 }, topRight: { x: 100, y: 50 }, bottomRight: { x: 50, y: 100 }, bottomLeft: { x: 0, y: 50 } }),
    ).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it('never returns a negative-size box for a degenerate (collinear) position', () => {
    const box = positionToBox({ topLeft: { x: 5, y: 5 }, topRight: { x: 5, y: 5 }, bottomRight: { x: 5, y: 5 }, bottomLeft: { x: 5, y: 5 } });
    expect(box.w).toBeGreaterThanOrEqual(0);
    expect(box.h).toBeGreaterThanOrEqual(0);
  });
});
