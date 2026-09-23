import { describe, expect, it } from 'vitest';
import { fitWithin, MAX_OUTPUT_SIDE } from '@/image/downscale';

describe('fitWithin (§6.4.7: longest side <= 1024)', () => {
  it('uses 1024 as the output cap', () => {
    expect(MAX_OUTPUT_SIDE).toBe(1024);
  });

  it('leaves an image already within the cap unchanged (never upscales)', () => {
    expect(fitWithin(330, 200, 1024)).toEqual({ w: 330, h: 200 });
  });

  it('scales a landscape image so its width is exactly the cap', () => {
    expect(fitWithin(4000, 2000, 1024)).toEqual({ w: 1024, h: 512 });
  });

  it('scales a portrait image so its height is exactly the cap', () => {
    expect(fitWithin(1000, 3000, 1024)).toEqual({ w: 341, h: 1024 });
  });

  it('never returns a zero dimension for an extreme aspect ratio', () => {
    expect(fitWithin(100_000, 10, 1024)).toEqual({ w: 1024, h: 1 });
  });
});
