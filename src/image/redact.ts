// §6.4.5: redaction = solid fill (opaque rectangle, padded by 10% of box
// size). No blur or pixelation -- both can sometimes be reversed.

import type { Box } from '@/models/capabilities';

// §6.4.5: each side grows by 10% of the box's own width (left/right) or
// height (top/bottom), so a detector's tight box still covers hairline/chin
// edges it tends to clip.
export const REDACTION_PAD_FRACTION = 0.1;

// Fill colour: opaque black. Any opaque colour would do; black is the
// conventional "redacted" bar and never blends with the pixels under it.
const REDACTION_FILL = '#000000';

// Rounds *outward* (floor the start, ceil the end) so rounding can only grow
// the covered area, never expose a sliver of the detection.
export function padBox(box: Box, imgW: number, imgH: number): Box | null {
  if (box.w <= 0 || box.h <= 0) return null;
  const padX = box.w * REDACTION_PAD_FRACTION;
  const padY = box.h * REDACTION_PAD_FRACTION;
  const x0 = Math.max(0, Math.floor(box.x - padX));
  const y0 = Math.max(0, Math.floor(box.y - padY));
  const x1 = Math.min(imgW, Math.ceil(box.x + box.w + padX));
  const y1 = Math.min(imgH, Math.ceil(box.y + box.h + padY));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// The subset of CanvasRenderingContext2D this needs -- structural, so unit
// tests can pass a recording fake instead of a real canvas.
export interface FillContext {
  fillStyle: unknown;
  globalAlpha: unknown;
  filter: unknown;
  fillRect(x: number, y: number, w: number, h: number): void;
}

// Returns how many boxes were actually painted (boxes entirely outside the
// image are skipped -- there is nothing of them in the pixels to hide).
export function redactBoxes(ctx: FillContext, boxes: Box[], imgW: number, imgH: number): number {
  // Reset anything that could make the fill non-opaque or soften its edges.
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.fillStyle = REDACTION_FILL;
  let painted = 0;
  for (const box of boxes) {
    const padded = padBox(box, imgW, imgH);
    if (!padded) continue;
    ctx.fillRect(padded.x, padded.y, padded.w, padded.h);
    painted++;
  }
  return painted;
}
