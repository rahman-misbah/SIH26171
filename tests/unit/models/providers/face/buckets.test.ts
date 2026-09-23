import { describe, expect, it } from 'vitest';
import { bucketFaceScore, MIN_DETECTION_CONFIDENCE } from '@/models/providers/face/buckets';
import { visionWorkerCount } from '@/models/providers/face/blazefaceMediapipe';

describe('BlazeFace confidence buckets (§8)', () => {
  it('sets a low detection floor, below MediaPipe’s 0.5 default (recall first)', () => {
    expect(MIN_DETECTION_CONFIDENCE).toBeLessThan(0.5);
  });

  it('maps raw scores to buckets', () => {
    expect(bucketFaceScore(0.3)).toBe('low');
    expect(bucketFaceScore(0.49)).toBe('low');
    expect(bucketFaceScore(0.5)).toBe('medium');
    expect(bucketFaceScore(0.74)).toBe('medium');
    expect(bucketFaceScore(0.75)).toBe('high');
    expect(bucketFaceScore(0.99)).toBe('high');
  });
});

describe('visionWorkerCount (§9.6: clamp(hardwareConcurrency - 2, 1, 3))', () => {
  it('clamps to the range 1..3', () => {
    expect(visionWorkerCount(1)).toBe(1);
    expect(visionWorkerCount(2)).toBe(1);
    expect(visionWorkerCount(4)).toBe(2);
    expect(visionWorkerCount(5)).toBe(3);
    expect(visionWorkerCount(32)).toBe(3);
  });
});
