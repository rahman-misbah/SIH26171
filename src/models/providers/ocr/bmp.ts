// M10 (§15 latency): 24-bit BMP encoding of RGBA pixels, for Tesseract.js
// input. Tesseract.js turns an OffscreenCanvas into bytes with
// convertToBlob() on the calling thread, which in Chromium's hidden
// offscreen document waits ~1 s for an idle period on every call (the same
// cause as M9 Noticed 1). Giving it encoded bytes skips that: BMP needs no
// compression, so it's a single fast pass in plain TypeScript, and
// Leptonica (inside Tesseract) always reads it.

const FILE_HEADER_BYTES = 14;
const INFO_HEADER_BYTES = 40; // BITMAPINFOHEADER
const HEADER_BYTES = FILE_HEADER_BYTES + INFO_HEADER_BYTES;

// Alpha is blended onto white, which is what Leptonica does itself when it
// drops an alpha channel (pixRemoveAlpha) -- so OCR sees what it saw with the
// old PNG input. Dropping alpha instead would turn a transparent background
// black and could hide dark text from OCR (fail open).
function overWhite(channel: number, alpha: number): number {
  return Math.round(channel * (alpha / 255) + 255 * (1 - alpha / 255));
}

export function encodeBmp24(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array<ArrayBuffer> {
  if (rgba.length !== width * height * 4) throw new Error('pixel buffer does not match dimensions');
  const rowBytes = Math.ceil((width * 3) / 4) * 4; // rows are padded to 4 bytes
  const size = HEADER_BYTES + rowBytes * height;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);

  out[0] = 0x42; // 'B'
  out[1] = 0x4d; // 'M'
  view.setUint32(2, size, true);
  view.setUint32(10, HEADER_BYTES, true);
  view.setUint32(14, INFO_HEADER_BYTES, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive: rows stored bottom-up
  view.setUint16(26, 1, true); // colour planes
  view.setUint16(28, 24, true); // bits per pixel
  view.setUint32(34, rowBytes * height, true); // image size (no compression)

  for (let y = 0; y < height; y++) {
    const src = y * width * 4;
    const dst = HEADER_BYTES + (height - 1 - y) * rowBytes;
    for (let x = 0; x < width; x++) {
      const i = src + x * 4;
      const a = rgba[i + 3] ?? 255;
      const o = dst + x * 3;
      out[o] = overWhite(rgba[i + 2] ?? 0, a); // B
      out[o + 1] = overWhite(rgba[i + 1] ?? 0, a); // G
      out[o + 2] = overWhite(rgba[i] ?? 0, a); // R
    }
  }
  return out;
}
