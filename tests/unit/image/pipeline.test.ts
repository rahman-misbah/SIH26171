import { describe, expect, it, vi } from 'vitest';
import { cacheKey, CACHE_TTL_MS } from '@/image/cachePolicy';
import { computeImgId } from '@/image/imgId';
import { createImagePipeline, type ImagePipelineDeps, type ImageRef } from '@/image/pipeline';
import type { ImageCacheRecord, ImageCacheStore } from '@/image/types';
import { ReasonCodeError } from '@/logging';
import type { LogRecord } from '@/logging';
import type { FaceDetector } from '@/models/capabilities';

const VERSION = 'face=face/test';
const SRC = 'https://example.com/a.png';
const REF: ImageRef = { node_id: 'n1', kind: 'img', src: SRC, natural_w: 200, natural_h: 100 };

function memoryCache(): ImageCacheStore & { records: Map<string, ImageCacheRecord> } {
  const records = new Map<string, ImageCacheRecord>();
  return {
    records,
    get: async (key) => records.get(key),
    put: async (record) => {
      records.set(record.key, record);
    },
  };
}

interface FakeBitmap {
  width: number;
  height: number;
  closed: boolean;
  close(): void;
  hash: string;
}

function fakeBitmap(hash = 'h'.repeat(64)): FakeBitmap {
  return {
    width: 200,
    height: 100,
    closed: false,
    hash,
    close() {
      this.closed = true;
    },
  };
}

function setup(overrides: Partial<ImagePipelineDeps> = {}, opts: { bitmap?: FakeBitmap; faces?: FaceDetector } = {}) {
  const cache = memoryCache();
  const records: LogRecord[] = [];
  const bitmap = opts.bitmap ?? fakeBitmap();
  let now = 1_000_000;
  const face: FaceDetector = opts.faces ?? {
    detect: vi.fn(async () => [{ box: { x: 10, y: 10, w: 50, h: 50 }, confidence: 'high' as const }]),
  };
  const deps: ImagePipelineDeps = {
    cache,
    logger: {
      record: (r) => records.push(r),
      recordSession: vi.fn(),
      recordModelLoad: vi.fn(),
      flush: vi.fn(async () => {}),
      stop: vi.fn(),
      timed: async (_op, _meta, fn) => fn(),
    },
    now: () => now,
    faceDetector: async () => face,
    detectorSetVersion: async () => VERSION,
    fetchImage: vi.fn(async () => ({ notModified: false as const, blob: new Blob([new Uint8Array([9])]), etag: '"e1"' })),
    decode: vi.fn(async () => bitmap as unknown as ImageBitmap),
    hashPixels: vi.fn(async (img: ImageBitmap) => (img as unknown as FakeBitmap).hash),
    redactAndEncode: vi.fn(async (_img: ImageBitmap, boxes) => ({
      blob: new Blob([new Uint8Array([1, 2])], { type: 'image/jpeg' }),
      painted: boxes.length,
    })),
    ...overrides,
  };
  const pipeline = createImagePipeline(deps);
  return {
    pipeline,
    deps,
    cache,
    records,
    bitmap,
    face,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const ops = (records: LogRecord[]) => records.map((r) => r.op);

describe('image pipeline: send gate (§6.4, M8 plan)', () => {
  it('withholds every processed image as detector_failed while OCR/QR stages do not exist yet', async () => {
    const { pipeline, records } = setup();
    const result = await pipeline.process('s', REF, new ArrayBuffer(4));
    expect(result.outcome).toBe('detector_failed');
    const gated = records.filter((r) => r.op === 'image.ocr' || r.op === 'image.qr');
    expect(gated.map((r) => [r.op, r.outcome, r.reason])).toEqual([
      ['image.ocr', 'fail_closed', 'detector_failed'],
      ['image.qr', 'fail_closed', 'detector_failed'],
    ]);
  });
});

describe('image pipeline: process (§6.2, §6.4)', () => {
  it('redacts every detected face box and caches the record -- but no pixels at all for a withheld image', async () => {
    const { pipeline, cache, deps, records } = setup();
    await pipeline.process('s', REF, new ArrayBuffer(4));

    expect(deps.redactAndEncode).toHaveBeenCalledWith(expect.anything(), [{ x: 10, y: 10, w: 50, h: 50 }]);
    const img_id = await computeImgId(SRC, 200, 100);
    const record = cache.records.get(cacheKey(img_id, VERSION));
    expect(record).toBeDefined();
    // Gated (no OCR/QR yet): the face-redacted output may still show text
    // PII, so it is never persisted.
    expect(record!.redacted_image).toBeUndefined();
    expect(record!.acquired_via).toBe('canvas');
    expect(record!.redaction_counts).toEqual({ faces: 1, text: 0, codes: 0 });
    expect(records.find((r) => r.op === 'image.face')?.counts).toEqual({ faces: 1 });
  });

  it('stores the redacted image only once the image has passed every required detector', async () => {
    const { pipeline, cache } = setup({ requiredForSend: ['face'] });
    const result = await pipeline.process('s', REF, new ArrayBuffer(4));
    expect(result.outcome).toBe('ok');
    const [record] = cache.records.values();
    expect(Object.keys(record!).sort()).toEqual(
      ['acquired_via', 'created_at', 'detector_set_version', 'etag', 'img_id', 'key', 'last_modified', 'raw_sha256', 'redacted_image', 'redaction_counts', 'validated_at'].sort(),
    );
    expect(record!.redacted_image?.type).toBe('image/jpeg');
  });

  it('closes the decoded pixels when done', async () => {
    const { pipeline, bitmap } = setup();
    await pipeline.process('s', REF, new ArrayBuffer(4));
    expect(bitmap.closed).toBe(true);
  });

  it('falls back to a host fetch when the content script had no pixels, keeping HTTP validators', async () => {
    const { pipeline, cache, deps } = setup();
    await pipeline.process('s', REF);
    expect(deps.fetchImage).toHaveBeenCalledWith(SRC);
    const [record] = cache.records.values();
    expect(record?.acquired_via).toBe('fetch');
    expect(record?.etag).toBe('"e1"');
  });

  it('withholds the image as unreadable when both canvas and fetch fail (§6.2.3)', async () => {
    const { pipeline, records, cache } = setup({
      fetchImage: vi.fn(async () => {
        throw new ReasonCodeError('unreadable');
      }),
    });
    await expect(pipeline.process('s', REF)).resolves.toEqual({ node_id: 'n1', outcome: 'unreadable' });
    expect(records.find((r) => r.op === 'image.acquire')).toMatchObject({ outcome: 'fail', reason: 'unreadable' });
    expect(cache.records.size).toBe(0);
  });

  it('withholds the image as unreadable when decoding fails', async () => {
    const { pipeline } = setup({
      decode: vi.fn(async () => {
        throw new ReasonCodeError('unreadable');
      }),
    });
    await expect(pipeline.process('s', REF, new ArrayBuffer(4))).resolves.toMatchObject({ outcome: 'unreadable' });
  });

  it('withholds the image as detector_failed when face detection throws, and caches nothing (§6.4.6)', async () => {
    const failing: FaceDetector = {
      detect: vi.fn(async () => {
        throw new Error('wasm crashed');
      }),
    };
    const { pipeline, cache, deps, bitmap } = setup({}, { faces: failing });
    await expect(pipeline.process('s', REF, new ArrayBuffer(4))).resolves.toMatchObject({ outcome: 'detector_failed' });
    expect(deps.redactAndEncode).not.toHaveBeenCalled();
    expect(cache.records.size).toBe(0);
    expect(bitmap.closed).toBe(true);
  });

  it('withholds the image as detector_failed when redaction/encoding throws', async () => {
    const { pipeline, cache } = setup({
      redactAndEncode: vi.fn(async () => {
        throw new Error('canvas lost');
      }),
    });
    await expect(pipeline.process('s', REF, new ArrayBuffer(4))).resolves.toMatchObject({ outcome: 'detector_failed' });
    expect(cache.records.size).toBe(0);
  });

  it('does not cache when a detector is running on its fallback (no detector_set_version)', async () => {
    const { pipeline, cache } = setup({ detectorSetVersion: async () => undefined });
    await pipeline.process('s', REF, new ArrayBuffer(4));
    expect(cache.records.size).toBe(0);
  });

  it('never caches inline (data:/blob:) images and derives their id from the pixel hash (§6.3)', async () => {
    const { pipeline, cache } = setup();
    const result = await pipeline.process('s', { ...REF, src: 'data:image/png;base64,AAAA' }, new ArrayBuffer(4));
    expect(result.img_id).toBe(`px-${'h'.repeat(32)}`);
    expect(cache.records.size).toBe(0);
  });
});

describe('image pipeline: lookup + cache (§6.6)', () => {
  it('reports a miss (logged) and asks for pixels the first time', async () => {
    const { pipeline, records } = setup();
    await expect(pipeline.lookup('s', [REF])).resolves.toEqual([{ node_id: 'n1', status: 'need_pixels' }]);
    expect(ops(records)).toContain('image.cache_miss');
  });

  it('answers a fresh hit from the cache without pixels or models (logged)', async () => {
    const { pipeline, records, face } = setup();
    await pipeline.process('s', REF, new ArrayBuffer(4));
    vi.mocked(face.detect).mockClear();

    const [result] = await pipeline.lookup('s', [REF]);
    expect(result).toMatchObject({ status: 'done', outcome: 'detector_failed' });
    expect(ops(records)).toContain('image.cache_hit');
    expect(face.detect).not.toHaveBeenCalled();
  });

  it('always asks for pixels for inline images', async () => {
    const { pipeline } = setup();
    const [result] = await pipeline.lookup('s', [{ ...REF, src: 'blob:https://example.com/1' }]);
    expect(result?.status).toBe('need_pixels');
  });

  it('past the TTL with validators: a 304 bumps validated_at without re-running models', async () => {
    const { pipeline, cache, deps, advance, face } = setup();
    await pipeline.process('s', REF); // fetch-acquired, etag "e1"
    vi.mocked(face.detect).mockClear();
    advance(CACHE_TTL_MS + 1);
    vi.mocked(deps.fetchImage).mockResolvedValueOnce({ notModified: true });

    const [result] = await pipeline.lookup('s', [REF]);
    expect(result?.status).toBe('done');
    expect(deps.fetchImage).toHaveBeenLastCalledWith(SRC, { etag: '"e1"', last_modified: undefined });
    const [record] = cache.records.values();
    expect(record?.validated_at).toBe(1_000_000 + CACHE_TTL_MS + 1);
    expect(face.detect).not.toHaveBeenCalled();
  });

  it('past the TTL with validators: a 200 with the same pixels bumps without re-running models', async () => {
    const { pipeline, advance, face } = setup();
    await pipeline.process('s', REF);
    vi.mocked(face.detect).mockClear();
    advance(CACHE_TTL_MS + 1);

    const [result] = await pipeline.lookup('s', [REF]);
    expect(result?.status).toBe('done');
    expect(face.detect).not.toHaveBeenCalled();
  });

  it('past the TTL with validators: a 200 with different pixels reprocesses', async () => {
    const { pipeline, deps, advance, face } = setup();
    await pipeline.process('s', REF);
    vi.mocked(face.detect).mockClear();
    advance(CACHE_TTL_MS + 1);
    vi.mocked(deps.decode).mockResolvedValueOnce(fakeBitmap('d'.repeat(64)) as unknown as ImageBitmap);

    const [result] = await pipeline.lookup('s', [REF]);
    expect(result?.status).toBe('done');
    expect(face.detect).toHaveBeenCalledTimes(1);
  });

  it('past the TTL without validators (canvas-acquired): asks for pixels, then reuses the record if the hash matches', async () => {
    const { pipeline, advance, face, records } = setup();
    await pipeline.process('s', REF, new ArrayBuffer(4));
    vi.mocked(face.detect).mockClear();
    advance(CACHE_TTL_MS + 1);

    const [looked] = await pipeline.lookup('s', [REF]);
    expect(looked?.status).toBe('need_pixels');

    await pipeline.process('s', REF, new ArrayBuffer(4));
    expect(face.detect).not.toHaveBeenCalled();
    expect(records.filter((r) => r.op === 'image.revalidate').at(-1)?.outcome).toBe('ok');
  });

  it('a revalidation that fails falls back to asking for pixels', async () => {
    const { pipeline, deps, advance } = setup();
    await pipeline.process('s', REF);
    advance(CACHE_TTL_MS + 1);
    vi.mocked(deps.fetchImage).mockRejectedValueOnce(new ReasonCodeError('unreadable'));

    const [result] = await pipeline.lookup('s', [REF]);
    expect(result?.status).toBe('need_pixels');
  });

  it('keys the cache by detector_set_version, so a detector change is a miss', async () => {
    let version = VERSION;
    const { pipeline } = setup({ detectorSetVersion: async () => version });
    await pipeline.process('s', REF, new ArrayBuffer(4));
    version = 'face=face/stronger';
    const [result] = await pipeline.lookup('s', [REF]);
    expect(result?.status).toBe('need_pixels');
  });
});
