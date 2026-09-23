// zxing-wasm position (four corners, possibly rotated or skewed) -> the
// axis-aligned Box the redactor fills (§9.2). Taking the min/max over all
// four corners covers the whole code whatever its rotation; the redactor
// then pads it by 10% (§6.4.5).

import type { Box } from '@/models/capabilities';

interface Point {
  x: number;
  y: number;
}
export interface CodePosition {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}

export function positionToBox(position: CodePosition): Box {
  const points = [position.topLeft, position.topRight, position.bottomRight, position.bottomLeft];
  const x0 = Math.min(...points.map((p) => p.x));
  const y0 = Math.min(...points.map((p) => p.y));
  const x1 = Math.max(...points.map((p) => p.x));
  const y1 = Math.max(...points.map((p) => p.y));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
