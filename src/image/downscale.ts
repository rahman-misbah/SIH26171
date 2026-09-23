// §6.4.7: the redacted output is downscaled so its longest side is <= 1024px
// (small payloads, §15). Pure dimension math; the actual resampling happens
// in render.ts on an OffscreenCanvas.

export const MAX_OUTPUT_SIDE = 1024;

// Never upscales; never returns a zero dimension (a 1px-tall sliver is still
// a valid image to encode).
export function fitWithin(w: number, h: number, maxSide: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= maxSide) return { w, h };
  const scale = maxSide / longest;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}
