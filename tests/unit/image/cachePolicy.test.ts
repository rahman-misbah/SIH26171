import { describe, expect, it } from 'vitest';
import { CACHE_TTL_MS, cacheKey, decideCache, revalidationOutcome } from '@/image/cachePolicy';
import type { ImageCacheRecord } from '@/image/types';

function record(overrides: Partial<ImageCacheRecord> = {}): ImageCacheRecord {
  return {
    key: 'id|face=x',
    img_id: 'id',
    detector_set_version: 'face=x',
    acquired_via: 'fetch',
    raw_sha256: 'f'.repeat(64),
    redacted_image: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
    redaction_counts: { faces: 1, text: 0, codes: 0 },
    created_at: 0,
    validated_at: 1_000,
    ...overrides,
  };
}

describe('cacheKey (§6.6: img_id + detector_set_version)', () => {
  it('combines both so a detector change is a different key', () => {
    expect(cacheKey('id', 'face=a')).not.toBe(cacheKey('id', 'face=b'));
    expect(cacheKey('id', 'face=a')).toBe(cacheKey('id', 'face=a'));
  });
});

describe('decideCache (§6.6)', () => {
  it('is a miss when there is no record', () => {
    expect(decideCache(undefined, 5_000)).toEqual({ kind: 'miss' });
  });

  it('uses a 30-minute TTL', () => {
    expect(CACHE_TTL_MS).toBe(30 * 60 * 1000);
  });

  it('is fresh within the TTL of validated_at', () => {
    const r = record();
    expect(decideCache(r, 1_000 + CACHE_TTL_MS)).toEqual({ kind: 'fresh', record: r });
  });

  it('is stale past the TTL, revalidated by conditional request when validators exist', () => {
    const r = record({ etag: '"abc"' });
    expect(decideCache(r, 1_000 + CACHE_TTL_MS + 1)).toEqual({ kind: 'stale', record: r, via: 'conditional' });
    const lm = record({ last_modified: 'Wed, 21 Oct 2015 07:28:00 GMT' });
    expect(decideCache(lm, 1_000 + CACHE_TTL_MS + 1)).toEqual({ kind: 'stale', record: lm, via: 'conditional' });
  });

  it('is stale past the TTL, revalidated by re-hashing when there are no validators', () => {
    const r = record();
    expect(decideCache(r, 1_000 + CACHE_TTL_MS + 1)).toEqual({ kind: 'stale', record: r, via: 'rehash' });
  });

  it('always re-hashes canvas-acquired images, which have no HTTP validators', () => {
    const r = record({ acquired_via: 'canvas', etag: '"stray"' });
    expect(decideCache(r, 1_000 + CACHE_TTL_MS + 1)).toEqual({ kind: 'stale', record: r, via: 'rehash' });
  });
});

describe('revalidationOutcome (§6.6)', () => {
  it('bumps validated_at on 304 Not Modified', () => {
    expect(revalidationOutcome(record(), { notModified: true })).toBe('bump');
  });

  it('bumps validated_at when the new bytes hash the same', () => {
    expect(revalidationOutcome(record(), { raw_sha256: 'f'.repeat(64) })).toBe('bump');
  });

  it('reprocesses when the new bytes hash differently', () => {
    expect(revalidationOutcome(record(), { raw_sha256: 'e'.repeat(64) })).toBe('reprocess');
  });
});
