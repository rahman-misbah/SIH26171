import { describe, expect, it } from 'vitest';
import { padBox, redactBoxes } from '@/image/redact';

describe('padBox (§6.4.5: padded by 10% of box size)', () => {
  it('expands each side by 10% of the box width/height', () => {
    expect(padBox({ x: 100, y: 100, w: 50, h: 100 }, 1000, 1000)).toEqual({ x: 95, y: 90, w: 60, h: 120 });
  });

  it('rounds outward so a fractional pad never shrinks the covered area', () => {
    // pad = 0.3px -> x floors to 9, right edge (10+3+0.3=13.3) ceils to 14
    expect(padBox({ x: 10, y: 10, w: 3, h: 3 }, 100, 100)).toEqual({ x: 9, y: 9, w: 5, h: 5 });
  });

  it('clamps to the image bounds', () => {
    // right edge: -5 + 20 + 2 (pad) = 17; bottom edge: 0 + 20 + 2 = 22
    expect(padBox({ x: -5, y: 0, w: 20, h: 20 }, 30, 30)).toEqual({ x: 0, y: 0, w: 17, h: 22 });
    expect(padBox({ x: 20, y: 20, w: 20, h: 20 }, 30, 30)).toEqual({ x: 18, y: 18, w: 12, h: 12 });
  });

  it('returns null for a box that lies entirely outside the image', () => {
    expect(padBox({ x: 200, y: 200, w: 10, h: 10 }, 100, 100)).toBeNull();
  });

  it('returns null for a zero-size box', () => {
    expect(padBox({ x: 10, y: 10, w: 0, h: 0 }, 100, 100)).toBeNull();
  });
});

describe('redactBoxes (§6.4.5: solid fill, never blur/pixelate)', () => {
  function fakeContext() {
    const fills: { x: number; y: number; w: number; h: number; style: unknown; alpha: unknown; filter: unknown }[] = [];
    const ctx = {
      fillStyle: '' as unknown,
      globalAlpha: 0.5 as unknown,
      filter: 'blur(4px)' as unknown,
      fillRect(x: number, y: number, w: number, h: number) {
        fills.push({ x, y, w, h, style: ctx.fillStyle, alpha: ctx.globalAlpha, filter: ctx.filter });
      },
    };
    return { ctx, fills };
  }

  it('fills every padded box with an opaque solid colour', () => {
    const { ctx, fills } = fakeContext();
    const count = redactBoxes(ctx, [{ x: 100, y: 100, w: 50, h: 100 }, { x: 0, y: 0, w: 10, h: 10 }], 1000, 1000);
    expect(count).toBe(2);
    expect(fills).toHaveLength(2);
    expect(fills[0]).toMatchObject({ x: 95, y: 90, w: 60, h: 120 });
    for (const fill of fills) {
      expect(fill.style).toBe('#000000');
      expect(fill.alpha).toBe(1);
      expect(fill.filter).toBe('none');
    }
  });

  it('skips boxes that fall outside the image and does not count them', () => {
    const { ctx, fills } = fakeContext();
    expect(redactBoxes(ctx, [{ x: 500, y: 500, w: 10, h: 10 }], 100, 100)).toBe(0);
    expect(fills).toHaveLength(0);
  });
});
