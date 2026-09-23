// §6.2 step 1: read an image's pixels in the content script by drawing it to
// an OffscreenCanvas -- no network cost. Returns a PNG (§4.3.7: lossless,
// and far smaller than raw RGBA over Chromium's base64 messaging), or a
// reason it couldn't: a cross-origin image without CORS taints the canvas
// (the browser then refuses to export it), and an image that never loaded
// has nothing to draw. Either way the compute host tries its own fetch next.

// Pixels sent to the compute host are capped at this longest side. The
// redacted output is <= 1024px anyway (§6.4.7); 2048 leaves detectors
// (and M9's OCR, which needs small text legible) twice that resolution
// while bounding the transfer -- M3 measured ~375 ms per MiB round trip on
// Chromium. A latency knob for M10, not a privacy one.
export const MAX_TRANSFER_SIDE = 2048;

// How long to wait for a CSS background image to load in a detached
// <img> before giving up and letting the host try (§6.2.2).
const BACKGROUND_LOAD_TIMEOUT_MS = 3_000;

export type PixelRead = { ok: true; png: ArrayBuffer } | { ok: false; reason: 'cors_blocked' | 'unreadable' };

export async function readPixels(img: HTMLImageElement): Promise<PixelRead> {
  // Not loaded (still loading, lazy and off-screen, or broken): don't wait
  // on it here -- the host fetch is the fallback.
  if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) return { ok: false, reason: 'unreadable' };

  const scale = Math.min(1, MAX_TRANSFER_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  try {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, reason: 'unreadable' };
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return { ok: true, png: await blob.arrayBuffer() };
  } catch (error) {
    // SecurityError = tainted canvas (cross-origin without CORS).
    return { ok: false, reason: error instanceof DOMException && error.name === 'SecurityError' ? 'cors_blocked' : 'unreadable' };
  }
}

// §6.1: CSS background images have no element to draw from, so load the
// (already absolute) URL into a detached <img>. Usually served from the
// browser's cache, since the page itself already loaded it.
export async function loadBackgroundImage(src: string): Promise<HTMLImageElement | undefined> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  try {
    await Promise.race([
      img.decode(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), BACKGROUND_LOAD_TIMEOUT_MS)),
    ]);
    return img;
  } catch {
    return undefined;
  }
}
