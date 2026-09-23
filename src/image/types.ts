// §6: image-pipeline contracts shared by the compute-host pipeline and its
// cache. Nothing here ever holds raw image bytes (§2.8) -- only hashes, HTTP
// validators, counts and the already-redacted output.

import type { ImageOmittedReason } from '@/dom/types';

export interface RedactionCounts {
  faces: number;
  text: number; // OCR words redacted (M9)
  codes: number; // QR/barcodes redacted (M9)
}

// §6.6's record, verbatim, plus three bookkeeping fields that are equally
// content-free: `key` (the IndexedDB keyPath), `detector_set_version` (the
// second half of that key, kept for inspection) and `acquired_via` (which
// revalidation path applies -- canvas-acquired images have no validators).
// **No raw bytes field, by construction** (§2.8, D9).
export interface ImageCacheRecord {
  key: string;
  img_id: string;
  detector_set_version: string;
  acquired_via: 'canvas' | 'fetch';
  raw_sha256: string;
  etag?: string;
  last_modified?: string;
  // JPEG, longest side <= 1024 (§6.4.7). Present **only** for an image that
  // passed every detector §6.4 requires before sending (the pipeline's send
  // gate) -- an image withheld for a missing/failed stage may still carry PII
  // that stage would have removed (e.g. text before OCR exists, M8), so its
  // pixels are never persisted, even redacted (CLAUDE.md: no raw PII
  // persisted; decided with the user during M8). The record alone still lets
  // a repeat observation skip every model (a cache hit).
  redacted_image?: Blob;
  redaction_counts: RedactionCounts;
  created_at: number;
  validated_at: number;
}

export interface ImageCacheStore {
  get(key: string): Promise<ImageCacheRecord | undefined>;
  put(record: ImageCacheRecord): Promise<void>;
}

// Per-image outcome reported back to the content script, which copies any
// omission reason onto the skeleton node (§2.10: every exclusion leaves a
// marker). 'ok' means "processed, redacted and eligible to be sent".
export type ImageOutcome = 'ok' | ImageOmittedReason;
