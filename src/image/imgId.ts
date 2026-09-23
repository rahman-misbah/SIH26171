// §6.3: img_id = sha256(currentSrc + "|" + naturalWidth + "x" + naturalHeight),
// truncated. Computed in the compute host, not the content script:
// `crypto.subtle` only exists in secure contexts, and a page served over
// plain http:// would leave the content script without it -- the extension
// origin always has it.

// 32 hex chars = 128 bits: plenty to make accidental collisions between
// images irrelevant, short enough to keep log refs and cache keys compact.
const IMG_ID_HEX_LENGTH = 32;

export async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// §6.3: data:/blob: sources are "inline" -- their URL *is* (or stands in
// for) the content, so it can't serve as a stable identity. Their img_id is
// derived from the pixel hash instead, and they are never cached: always
// processed fresh (a blob: URL can be revoked and reused for different
// pixels; a data: URL can be megabytes long and would bloat every key).
export function isInlineSource(src: string): boolean {
  const lower = src.slice(0, 5).toLowerCase();
  return lower === 'data:' || lower === 'blob:';
}

export async function computeImgId(src: string, naturalW: number, naturalH: number): Promise<string> {
  const full = await sha256Hex(new TextEncoder().encode(`${src}|${naturalW}x${naturalH}`));
  return full.slice(0, IMG_ID_HEX_LENGTH);
}

// Prefixed so a pixel-derived id can never collide with a URL-derived one.
export function pixelImgId(rawSha256: string): string {
  return `px-${rawSha256.slice(0, IMG_ID_HEX_LENGTH)}`;
}
