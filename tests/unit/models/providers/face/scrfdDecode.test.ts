import { describe, expect, it } from 'vitest';
import {
  decodeScrfd,
  letterboxFor,
  nms,
  SCRFD_INPUT_SIZE,
  SCRFD_MIN_SCORE,
  SCRFD_NMS_IOU,
  SCRFD_STRIDES,
  type ScrfdOutputs,
} from '@/models/providers/face/scrfdDecode';

// Anchors per stride on a 640x640 input: (640/s)^2 cells x 2 anchors each.
function emptyOutputs(): ScrfdOutputs {
  return SCRFD_STRIDES.map((stride) => {
    const anchors = (SCRFD_INPUT_SIZE / stride) ** 2 * 2;
    return { stride, scores: new Float32Array(anchors), distances: new Float32Array(anchors * 4) };
  });
}

// Anchor index for cell (col,row), anchor a (0|1), at a given stride.
function anchorIndex(stride: number, col: number, row: number, a: 0 | 1): number {
  const w = SCRFD_INPUT_SIZE / stride;
  return (row * w + col) * 2 + a;
}

function setAnchor(out: ScrfdOutputs, strideIdx: number, index: number, score: number, d: [number, number, number, number]): void {
  const level = out[strideIdx]!;
  level.scores[index] = score;
  level.distances.set(d, index * 4);
}

describe('letterboxFor', () => {
  it('fits the long side to 640 and keeps the aspect ratio', () => {
    expect(letterboxFor(1280, 640)).toEqual({ scale: 0.5, width: 640, height: 320 });
    expect(letterboxFor(320, 640)).toEqual({ scale: 1, width: 320, height: 640 });
  });

  it('upscales small images too (small faces get more pixels)', () => {
    expect(letterboxFor(160, 80)).toEqual({ scale: 4, width: 640, height: 320 });
  });
});

describe('decodeScrfd (InsightFace scrfd.py anchor maths)', () => {
  it('decodes one anchor: centre = cell * stride, box = centre -/+ distance * stride', () => {
    const out = emptyOutputs();
    // stride 8, cell (10, 5) -> centre (80, 40); distances (1,2,3,4) * 8.
    setAnchor(out, 0, anchorIndex(8, 10, 5, 1), 0.9, [1, 2, 3, 4]);
    const dets = decodeScrfd(out, { scale: 1, imageWidth: 640, imageHeight: 640 });
    expect(dets).toEqual([{ box: { x: 72, y: 24, w: 32, h: 48 }, score: expect.closeTo(0.9, 5) }]);
  });

  it('uses the right grid width per stride', () => {
    const out = emptyOutputs();
    // stride 32: grid is 20 wide; cell (3, 2) -> centre (96, 64).
    setAnchor(out, 2, anchorIndex(32, 3, 2, 0), 0.8, [1, 1, 1, 1]);
    const [det] = decodeScrfd(out, { scale: 1, imageWidth: 640, imageHeight: 640 });
    expect(det?.box).toEqual({ x: 64, y: 32, w: 64, h: 64 });
  });

  it('maps boxes back to image pixels by dividing by the letterbox scale', () => {
    const out = emptyOutputs();
    setAnchor(out, 0, anchorIndex(8, 10, 5, 0), 0.9, [1, 2, 3, 4]);
    const [det] = decodeScrfd(out, { scale: 0.5, imageWidth: 1280, imageHeight: 1280 });
    expect(det?.box).toEqual({ x: 144, y: 48, w: 64, h: 96 });
  });

  it('clamps boxes to the image', () => {
    const out = emptyOutputs();
    // centre (0, 0), extends 16 px in every direction.
    setAnchor(out, 0, anchorIndex(8, 0, 0, 0), 0.9, [2, 2, 2, 2]);
    const [det] = decodeScrfd(out, { scale: 1, imageWidth: 640, imageHeight: 640 });
    expect(det?.box).toEqual({ x: 0, y: 0, w: 16, h: 16 });
  });

  it('keeps scores at the floor and drops those below it', () => {
    const out = emptyOutputs();
    setAnchor(out, 0, anchorIndex(8, 10, 10, 0), SCRFD_MIN_SCORE, [1, 1, 1, 1]);
    setAnchor(out, 0, anchorIndex(8, 40, 40, 0), SCRFD_MIN_SCORE - 0.01, [1, 1, 1, 1]);
    expect(decodeScrfd(out, { scale: 1, imageWidth: 640, imageHeight: 640 })).toHaveLength(1);
  });

  it('sets a detection floor below InsightFace’s 0.5 default (recall first)', () => {
    expect(SCRFD_MIN_SCORE).toBeLessThan(0.5);
  });

  it('drops boxes that fall entirely in the letterbox padding', () => {
    const out = emptyOutputs();
    // Image is 640x320 in model space (scale 1): a box at y=600 is padding.
    setAnchor(out, 0, anchorIndex(8, 10, 75, 0), 0.9, [1, 1, 1, 1]);
    expect(decodeScrfd(out, { scale: 1, imageWidth: 640, imageHeight: 320 })).toEqual([]);
  });
});

describe('nms', () => {
  it('keeps the higher-scoring of two heavily overlapping boxes', () => {
    const a = { box: { x: 0, y: 0, w: 100, h: 100 }, score: 0.9 };
    const b = { box: { x: 5, y: 5, w: 100, h: 100 }, score: 0.6 };
    expect(nms([b, a], SCRFD_NMS_IOU)).toEqual([a]);
  });

  it('keeps boxes whose overlap is at or below the threshold', () => {
    const a = { box: { x: 0, y: 0, w: 100, h: 100 }, score: 0.9 };
    const b = { box: { x: 200, y: 0, w: 100, h: 100 }, score: 0.6 };
    expect(nms([a, b], SCRFD_NMS_IOU)).toEqual([a, b]);
  });

  it('decodeScrfd applies NMS across strides', () => {
    const out = emptyOutputs();
    // The same face seen at stride 8 and stride 16 (identical boxes).
    setAnchor(out, 0, anchorIndex(8, 10, 10, 0), 0.7, [4, 4, 4, 4]); // centre (80,80), 64x64
    setAnchor(out, 1, anchorIndex(16, 5, 5, 0), 0.9, [2, 2, 2, 2]); // centre (80,80), 64x64
    const dets = decodeScrfd(out, { scale: 1, imageWidth: 640, imageHeight: 640 });
    expect(dets).toHaveLength(1);
    expect(dets[0]?.score).toBeCloseTo(0.9, 5);
  });
});
