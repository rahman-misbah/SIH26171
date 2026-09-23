// §14.3: "Re-encode to fit maxImageBytes." Pure step-down driver; the
// actual JPEG re-encode (OffscreenCanvas) is injected by render.ts. Input is
// the already-redacted output -- redaction is burnt into its pixels, so a
// smaller or lower-quality copy can only lose detail, never reveal any.

export interface FitStep {
  quality: number; // JPEG quality, 0..1
  scale: number; // of the redacted image's own size
}

// Quality first (cheap on legibility), then size. The redacted output is
// already <= 1024 px at quality 0.85 (render.ts), which is a few hundred KB
// at most, so against Groq's 3 MB budget these steps are a safety net for
// a backend with a much smaller one. Stops at 0.35 scale / quality 0.5:
// below that on-image text is unreadable and the image isn't worth sending.
export const FIT_STEPS: readonly FitStep[] = [
  { quality: 0.7, scale: 1 },
  { quality: 0.55, scale: 1 },
  { quality: 0.55, scale: 0.75 },
  { quality: 0.5, scale: 0.5 },
  { quality: 0.5, scale: 0.35 },
];

// undefined -> nothing fits; the caller withholds the image with
// `request_limit` (decided in the M9 plan).
export async function fitImageBytes(
  blob: Blob,
  maxBytes: number,
  reencode: (step: FitStep) => Promise<Blob>,
): Promise<Blob | undefined> {
  if (blob.size <= maxBytes) return blob;
  for (const step of FIT_STEPS) {
    const candidate = await reencode(step);
    if (candidate.size <= maxBytes) return candidate;
  }
  return undefined;
}
