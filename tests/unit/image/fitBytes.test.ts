// §14.3 "Re-encode to fit maxImageBytes": the step-down loop, with the
// encoder faked. Written before the implementation.

import { describe, expect, it, vi } from 'vitest';
import { FIT_STEPS, fitImageBytes, type FitStep } from '@/image/fitBytes';

function blobOf(size: number): Blob {
  return new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
}

describe('fitImageBytes', () => {
  it('returns the original untouched when it already fits', async () => {
    const reencode = vi.fn();
    const original = blobOf(100);
    expect(await fitImageBytes(original, 100, reencode)).toBe(original);
    expect(reencode).not.toHaveBeenCalled();
  });

  it('steps down until a re-encode fits, and stops there', async () => {
    const sizes = [900, 400, 150];
    const reencode = vi.fn<(step: FitStep) => Promise<Blob>>(async () => blobOf(sizes.shift() ?? 0));
    const result = await fitImageBytes(blobOf(1000), 200, reencode);
    expect(result?.size).toBe(150);
    expect(reencode).toHaveBeenCalledTimes(3);
    expect(reencode.mock.calls.map((c) => c[0])).toEqual(FIT_STEPS.slice(0, 3));
  });

  it('returns undefined when no step fits (caller marks request_limit)', async () => {
    const reencode = vi.fn(async () => blobOf(10_000));
    expect(await fitImageBytes(blobOf(10_000), 10, reencode)).toBeUndefined();
    expect(reencode).toHaveBeenCalledTimes(FIT_STEPS.length);
  });

  it('every step lowers quality or scale, never raises either', () => {
    for (let i = 1; i < FIT_STEPS.length; i++) {
      expect(FIT_STEPS[i]!.quality).toBeLessThanOrEqual(FIT_STEPS[i - 1]!.quality);
      expect(FIT_STEPS[i]!.scale).toBeLessThanOrEqual(FIT_STEPS[i - 1]!.scale);
    }
  });
});
