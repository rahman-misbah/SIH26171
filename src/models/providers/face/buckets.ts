// §8: BlazeFace's raw detection score -> bucket. Face boxes are redacted
// whatever their bucket (§6.4.1, fail-closed); the bucket only exists so the
// logs can show how confident detections were, for threshold tuning (§8.3).

// §8.4: default thresholds set low, favouring recall. MediaPipe discards
// anything under this before we ever see it, so it is the effective recall
// floor for the whole face stage. 0.3 (vs. MediaPipe's own 0.5 default)
// keeps partially-occluded / small / off-angle faces that a tight threshold
// would drop -- over-redaction is acceptable, a missed face is not (§2.1).
export const MIN_DETECTION_CONFIDENCE = 0.3;

// Bucket edges: below 0.5 is "MediaPipe itself would have dropped this"
// (low); 0.5-0.75 is a plausible but unsure face (medium); 0.75+ is the
// range BlazeFace reports for clear frontal faces (high).
const MEDIUM_FROM = 0.5;
const HIGH_FROM = 0.75;

export function bucketFaceScore(score: number): 'low' | 'medium' | 'high' {
  if (score >= HIGH_FROM) return 'high';
  if (score >= MEDIUM_FROM) return 'medium';
  return 'low';
}
