import { describe, expect, it, vi } from 'vitest';
import type { FaceDetector } from '@/models/capabilities';
import { unionFaceDetectors } from '@/models/providers/face/union';

const IMG = { data: {} as ImageData };
const face = (x: number) => ({ box: { x, y: 0, w: 10, h: 10 }, confidence: 'high' as const });

function fake(result: ReturnType<typeof face>[] | Error, queueMs = 0, poolSize?: number): FaceDetector {
  return {
    poolSize,
    detect: vi.fn(async (_img, options) => {
      options?.onQueueWait?.(queueMs);
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

describe('unionFaceDetectors (M12: SCRFD + BlazeFace)', () => {
  it('returns every box from both detectors, run on the same image', async () => {
    const a = fake([face(1)]);
    const b = fake([face(2), face(3)]);
    const faces = await unionFaceDetectors(a, b).detect(IMG);

    expect(faces.map((f) => f.box.x)).toEqual([1, 2, 3]);
    expect(a.detect).toHaveBeenCalledWith(IMG, undefined);
    expect(b.detect).toHaveBeenCalledWith(IMG, undefined);
  });

  it('keeps a face only one detector found (the reason for the union)', async () => {
    expect(await unionFaceDetectors(fake([]), fake([face(7)])).detect(IMG)).toHaveLength(1);
    expect(await unionFaceDetectors(fake([face(7)]), fake([])).detect(IMG)).toHaveLength(1);
  });

  it('rejects if either detector fails, so the image is withheld (fail closed)', async () => {
    await expect(unionFaceDetectors(fake([face(1)]), fake(new Error('boom'))).detect(IMG)).rejects.toThrow('boom');
    await expect(unionFaceDetectors(fake(new Error('boom')), fake([face(1)])).detect(IMG)).rejects.toThrow('boom');
  });

  it('reports the longer queue wait once, since the call waits for both', async () => {
    const onQueueWait = vi.fn();
    await unionFaceDetectors(fake([], 5), fake([], 40)).detect(IMG, { onQueueWait });
    expect(onQueueWait).toHaveBeenCalledTimes(1);
    expect(onQueueWait).toHaveBeenCalledWith(40);
  });

  it('exposes the larger pool size, so warm start warms every worker of both', () => {
    expect(unionFaceDetectors(fake([], 0, 3), fake([], 0, 2)).poolSize).toBe(3);
    expect(unionFaceDetectors(fake([]), fake([])).poolSize).toBe(1);
  });
});
