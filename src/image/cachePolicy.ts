// §6.6: cache decision rules, as pure functions (the IndexedDB store and the
// network/pixel re-reads live elsewhere). TTL is measured from
// `validated_at`, not `created_at`, so a revalidated entry gets a fresh 30
// minutes without re-running any model.

import type { ImageCacheRecord } from './types';

// §6.6: 30 minutes.
export const CACHE_TTL_MS = 30 * 60 * 1000;

// §6.6: key = img_id + detector_set_version. The version changes whenever
// the active model tiers change, so a stronger model is never skipped
// because of a result an older/weaker one produced.
export function cacheKey(img_id: string, detector_set_version: string): string {
  return `${img_id}|${detector_set_version}`;
}

export type CacheDecision =
  | { kind: 'miss' }
  | { kind: 'fresh'; record: ImageCacheRecord }
  // 'conditional' = If-None-Match/If-Modified-Since request; 'rehash' = re-read
  // the pixels (canvas, or a plain fetch) and compare raw_sha256.
  | { kind: 'stale'; record: ImageCacheRecord; via: 'conditional' | 'rehash' };

export function decideCache(record: ImageCacheRecord | undefined, now: number): CacheDecision {
  if (!record) return { kind: 'miss' };
  if (now - record.validated_at <= CACHE_TTL_MS) return { kind: 'fresh', record };
  // §6.6: canvas-acquired images have no validators; revalidation re-reads
  // pixels via canvas and compares hashes.
  const hasValidators = record.acquired_via === 'fetch' && (record.etag !== undefined || record.last_modified !== undefined);
  return { kind: 'stale', record, via: hasValidators ? 'conditional' : 'rehash' };
}

// §6.6: 304 -> bump validated_at. 200 (or no validators) -> hash the new
// bytes; same raw_sha256 -> bump without re-running models; different ->
// reprocess.
export function revalidationOutcome(
  record: ImageCacheRecord,
  result: { notModified: true } | { raw_sha256: string },
): 'bump' | 'reprocess' {
  if ('notModified' in result) return 'bump';
  return result.raw_sha256 === record.raw_sha256 ? 'bump' : 'reprocess';
}

// M12 pruning (M9 Noticed 5: records were never deleted, so browsing real
// sites grew the store without bound). Runs at compute-host start.
//
// 24 h: well past the 30-minute TTL, so a record can still save a model run
// by revalidation (§6.6) within a day's browsing; after that it's more likely
// a page the user won't revisit.
export const CACHE_PRUNE_AGE_MS = 24 * 60 * 60 * 1000;
// 300 records: a redacted image is a JPEG of at most 1024 px on its longest
// side (§6.4.7), typically 50-200 KB, so the store stays around tens of MB.
// Least recently validated records go first.
export const CACHE_MAX_RECORDS = 300;

export function selectPrunable(entries: { key: string; validated_at: number }[], now: number): string[] {
  const expired = entries.filter((e) => now - e.validated_at > CACHE_PRUNE_AGE_MS);
  const kept = entries.filter((e) => now - e.validated_at <= CACHE_PRUNE_AGE_MS).sort((a, b) => b.validated_at - a.validated_at);
  return [...expired, ...kept.slice(CACHE_MAX_RECORDS)].map((e) => e.key);
}
