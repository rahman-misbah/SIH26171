// §9.5 tier-2 face: SCRFD-2.5G pre/post-processing as pure functions, so the
// anchor maths is unit-tested without a model. Ported from InsightFace's
// reference implementation (python-package/insightface/model_zoo/scrfd.py)
// and checked against the real det_2.5g.onnx outputs (M11): for a 640x640
// input it returns, per stride 8/16/32, (640/s)^2 * 2 scores (already
// sigmoided) and as many 4-value box distances, in row-major cell order with
// the 2 anchors of a cell next to each other. The keypoint outputs are unused.

import type { Box } from '@/models/capabilities';

// The model is fully convolutional, but InsightFace runs it at 640x640 and
// its published WIDER FACE numbers are for that size; we do the same.
export const SCRFD_INPUT_SIZE = 640;
export const SCRFD_STRIDES = [8, 16, 32] as const;

// §8.4: recall first. InsightFace's own default is det_thresh = 0.5; 0.3
// keeps small / blurred / side-on faces it would drop, the same floor
// BlazeFace uses (buckets.ts). Over-redaction is acceptable, a missed face
// is not (§2.1).
export const SCRFD_MIN_SCORE = 0.3;

// InsightFace's reference NMS threshold. Two boxes overlapping more than
// this (IoU) are taken to be the same face, seen by two anchors or strides.
export const SCRFD_NMS_IOU = 0.4;

export interface ScrfdLevel {
  stride: number;
  scores: Float32Array; // one per anchor
  distances: Float32Array; // 4 per anchor: left, top, right, bottom, in stride units
}
export type ScrfdOutputs = ScrfdLevel[];

export interface Detection {
  box: Box; // image pixels
  score: number;
}

// Resize so the long side is 640, keeping the aspect ratio; the image sits
// in the top-left corner of the 640x640 input and the rest is zero padding
// (as in scrfd.py). Small images are scaled up, which gives small faces
// more pixels.
export function letterboxFor(
  imageWidth: number,
  imageHeight: number,
  size: number = SCRFD_INPUT_SIZE,
): { scale: number; width: number; height: number } {
  const scale = size / Math.max(imageWidth, imageHeight);
  return { scale, width: Math.round(imageWidth * scale), height: Math.round(imageHeight * scale) };
}

function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

// Greedy NMS: highest score first, drop anything overlapping a kept box by
// more than `threshold`.
export function nms(detections: Detection[], threshold: number): Detection[] {
  const sorted = [...detections].sort((a, b) => b.score - a.score);
  const kept: Detection[] = [];
  for (const det of sorted) {
    if (kept.every((k) => iou(k.box, det.box) <= threshold)) kept.push(det);
  }
  return kept;
}

export function decodeScrfd(
  outputs: ScrfdOutputs,
  frame: { scale: number; imageWidth: number; imageHeight: number },
  minScore: number = SCRFD_MIN_SCORE,
): Detection[] {
  const candidates: Detection[] = [];

  for (const { stride, scores, distances } of outputs) {
    const gridWidth = SCRFD_INPUT_SIZE / stride;
    for (let i = 0; i < scores.length; i++) {
      const score = scores[i] ?? 0;
      if (score < minScore) continue;

      // Two anchors per cell, stored next to each other.
      const cell = Math.floor(i / 2);
      const cx = (cell % gridWidth) * stride;
      const cy = Math.floor(cell / gridWidth) * stride;
      const [l = 0, t = 0, r = 0, b = 0] = distances.subarray(i * 4, i * 4 + 4);

      // Model space -> image pixels, clamped to the image. Anything left
      // with no area was in the letterbox padding.
      const x1 = Math.max(0, (cx - l * stride) / frame.scale);
      const y1 = Math.max(0, (cy - t * stride) / frame.scale);
      const x2 = Math.min(frame.imageWidth, (cx + r * stride) / frame.scale);
      const y2 = Math.min(frame.imageHeight, (cy + b * stride) / frame.scale);
      if (x2 <= x1 || y2 <= y1) continue;

      candidates.push({ box: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, score });
    }
  }

  return nms(candidates, SCRFD_NMS_IOU);
}
