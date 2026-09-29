// §6.4, M12: can this browser read a 2D canvas back correctly? Under PRIME
// offload with Chrome's Vulkan feature (CLAUDE.md, browser quirks) every
// getImageData() returns transparent black with no error, so every detector
// would see a blank image and find nothing. This runs the same steps the
// image path does (pixels -> ImageBitmap -> drawImage -> getImageData) on a
// known pattern and compares exactly.

// 4x4 is enough: the failure is all-or-nothing, and a tiny canvas costs
// nothing. Every pixel is opaque (alpha 255), so premultiplied alpha can't
// change the values, and nothing is scaled, so an exact match is expected.
const SIDE = 4;

function pattern(): Uint8ClampedArray<ArrayBuffer> {
  const data = new Uint8ClampedArray(SIDE * SIDE * 4);
  for (let i = 0; i < SIDE * SIDE; i++) {
    // Distinct, non-zero channels per pixel, so neither a blank read nor a
    // shifted/swapped one can match by accident.
    data[i * 4] = 16 + i * 14;
    data[i * 4 + 1] = 240 - i * 13;
    data[i * 4 + 2] = 64 + ((i * 37) % 160);
    data[i * 4 + 3] = 255;
  }
  return data;
}

export async function checkPixelReadback(): Promise<boolean> {
  const expected = pattern();
  const source = new OffscreenCanvas(SIDE, SIDE);
  const sourceCtx = source.getContext('2d');
  if (!sourceCtx) return false;
  sourceCtx.putImageData(new ImageData(expected, SIDE, SIDE), 0, 0);

  const bitmap = await createImageBitmap(source);
  try {
    const target = new OffscreenCanvas(SIDE, SIDE);
    const ctx = target.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(bitmap, 0, 0);
    const actual = ctx.getImageData(0, 0, SIDE, SIDE).data;
    return actual.every((value, i) => value === expected[i]);
  } finally {
    bitmap.close();
  }
}
