// §6.2-§6.4 pixel work in the compute host: decode, hash, solid-fill redact,
// downscale, encode. Browser-only (OffscreenCanvas / createImageBitmap), so
// it's exercised by the e2e suite; the decisions it relies on (padBox,
// fitWithin) are pure and unit-tested on their own.

import { ReasonCodeError } from '@/logging';
import type { Box } from '@/models/capabilities';
import { fitWithin, MAX_OUTPUT_SIDE } from './downscale';
import type { FitStep } from './fitBytes';
import { sha256Hex } from './imgId';
import { redactBoxes } from './redact';

// JPEG quality for the redacted output (§6.4.7: "JPEG/WebP"). 0.85 keeps
// on-image text legible for the agent at a fraction of PNG's size (§15
// small payloads); redaction boxes are flat black, which JPEG encodes
// without artefacts that could hint at what was underneath.
const JPEG_QUALITY = 0.85;

function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ReasonCodeError('detector_failed', '2d context unavailable');
  return ctx;
}

export async function decodeImage(bytes: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(bytes);
  } catch {
    throw new ReasonCodeError('unreadable');
  }
}

// §6.6 raw_sha256: a hash of the decoded RGBA pixels (not the file bytes),
// so canvas-acquired and fetch-acquired copies of one image are comparable.
export async function hashPixels(image: ImageBitmap): Promise<string> {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = context2d(canvas);
  ctx.drawImage(image, 0, 0);
  return sha256Hex(ctx.getImageData(0, 0, image.width, image.height).data);
}

// Redacts at full resolution (boxes are in the image's own pixel space),
// *then* downscales, so a box can never be lost to resampling.
export async function redactAndEncode(image: ImageBitmap, boxes: Box[]): Promise<{ blob: Blob; painted: number }> {
  const full = new OffscreenCanvas(image.width, image.height);
  const fullCtx = context2d(full);
  fullCtx.drawImage(image, 0, 0);
  const painted = redactBoxes(fullCtx, boxes, image.width, image.height);

  const size = fitWithin(image.width, image.height, MAX_OUTPUT_SIDE);
  const out = new OffscreenCanvas(size.w, size.h);
  context2d(out).drawImage(full, 0, 0, size.w, size.h);
  return { blob: await out.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY }), painted };
}

// §14.3: one step of the fit-to-maxImageBytes loop (fitBytes.ts). Input is
// the already-redacted JPEG, never raw pixels.
export async function reencodeJpeg(redacted: Blob, step: FitStep): Promise<Blob> {
  const image = await createImageBitmap(redacted);
  try {
    const w = Math.max(1, Math.round(image.width * step.scale));
    const h = Math.max(1, Math.round(image.height * step.scale));
    const out = new OffscreenCanvas(w, h);
    context2d(out).drawImage(image, 0, 0, w, h);
    return await out.convertToBlob({ type: 'image/jpeg', quality: step.quality });
  } finally {
    image.close();
  }
}
