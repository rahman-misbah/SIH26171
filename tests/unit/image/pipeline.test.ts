import { describe, expect, it, vi } from 'vitest';
import { cacheKey, CACHE_TTL_MS } from '@/image/cachePolicy';
import { computeImgId } from '@/image/imgId';
import { createImagePipeline, type ImagePipelineDeps, type ImageRef } from '@/image/pipeline';
import type { ImageCacheRecord, ImageCacheStore } from '@/image/types';
import { ReasonCodeError } from '@/logging';
import type { LogRecord } from '@/logging';
import { SendableImageStore } from '@/image/sendable';
import type { FaceDetector, OcrEngine, PiiNer, QrDetector } from '@/models/capabilities';
import { TokenMapImpl } from '@/sanitize/tokenMap';

const VERSION = 'face=face/test;ocr=ocr/test;qr=qr/test';
const CTX = { session_id: 's', origin: 'https://example.com' };
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

type OcrWords = Awaited<ReturnType<OcrEngine['read']>>;

function setup(
  overrides: Partial<ImagePipelineDeps> = {},
  opts: { bitmap?: FakeBitmap; faces?: FaceDetector; ocr?: OcrEngine; qr?: QrDetector; ner?: PiiNer } = {},
) {
  const cache = memoryCache();
  const records: LogRecord[] = [];
  const bitmap = opts.bitmap ?? fakeBitmap();
  let now = 1_000_000;
  const face: FaceDetector = opts.faces ?? {
    detect: vi.fn(async () => [{ box: { x: 10, y: 10, w: 50, h: 50 }, confidence: 'high' as const }]),
  };
  const ocr: OcrEngine = opts.ocr ?? { read: vi.fn(async (): Promise<OcrWords> => []) };
  const qr: QrDetector = opts.qr ?? { detect: vi.fn(async () => []) };
  const ner: PiiNer = opts.ner ?? { tag: async (texts) => texts.map(() => []) };
  const tokenMap = new TokenMapImpl();
  const sendable = new SendableImageStore();
  const deps: ImagePipelineDeps = {
    cache,
    sendable,
    ocrEngine: async () => ocr,
    qrDetector: async () => qr,
    ner: async () => ner,
    tokenMap: () => tokenMap,
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
    ocr,
    qr,
    tokenMap,
    sendable,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const ops = (records: LogRecord[]) => records.map((r) => r.op);

const ocrWord = (text: string, x: number): OcrWords[number] => ({ text, line: 0, confidence: 'high', box: { x, y: 60, w: 40, h: 12 } });

describe('image pipeline: process (§6.2, §6.4)', () => {
  it('runs face, OCR and QR on every image and redacts faces, codes and PII words in one pass', async () => {
    const qr: QrDetector = { detect: vi.fn(async () => [{ box: { x: 100, y: 0, w: 30, h: 30 }, confidence: 'high' as const }]) };
    const ocr: OcrEngine = { read: vi.fn(async () => [ocrWord('Order', 0), ocrWord('ABCPE1234F', 50)]) };
    const { pipeline, deps, face } = setup({}, { qr, ocr });
    const result = await pipeline.process(CTX, REF, new ArrayBuffer(4));

    expect(result.outcome).toBe('ok');
    expect(face.detect).toHaveBeenCalledTimes(1);
    expect(ocr.read).toHaveBeenCalledTimes(1);
    expect(qr.detect).toHaveBeenCalledTimes(1);
    // face box, then the PAN word (not 'Order'), then the code
    expect(deps.redactAndEncode).toHaveBeenCalledWith(expect.anything(), [
      { x: 10, y: 10, w: 50, h: 50 },
      { x: 50, y: 60, w: 40, h: 12 },
      { x: 100, y: 0, w: 30, h: 30 },
    ]);
  });

  it('caches the record with the redacted image and real counts, and marks it sendable', async () => {
    const ocr: OcrEngine = { read: vi.fn(async () => [ocrWord('ABCPE1234F', 50)]) };
    const { pipeline, cache, sendable, records } = setup({}, { ocr });
    await pipeline.process(CTX, REF, new ArrayBuffer(4));

    const img_id = await computeImgId(SRC, 200, 100);
    const record = cache.records.get(cacheKey(img_id, VERSION));
    expect(Object.keys(record!).sort()).toEqual(
      ['acquired_via', 'created_at', 'detector_set_version', 'etag', 'img_id', 'key', 'last_modified', 'raw_sha256', 'redacted_image', 'redaction_counts', 'validated_at'].sort(),
    );
    expect(record!.redacted_image?.type).toBe('image/jpeg');
    expect(record!.redaction_counts).toEqual({ faces: 1, text: 1, codes: 0 });
    expect(sendable.forSession('s').get('n1')?.img_id).toBe(img_id);
    expect(records.find((r) => r.op === 'image.ocr')?.counts).toEqual({ words: 1 });
    expect(records.find((r) => r.op === 'image.redact')?.counts).toMatchObject({ faces: 1, words: 1, codes: 0 });
  });

  it('tokenizes OCR PII under the request origin with an {img_id, bbox} source (§6.5)', async () => {
    const ocr: OcrEngine = { read: vi.fn(async () => [ocrWord('ABCPE1234F', 50)]) };
    const { pipeline, tokenMap } = setup({}, { ocr });
    const result = await pipeline.process(CTX, REF, new ArrayBuffer(4));
    const entry = tokenMap.entryForToken('[PII_PAN_1]');
    expect(entry?.origin).toBe('https://example.com');
    expect(entry?.sources).toEqual([{ img_id: result.img_id, bbox: { x: 50, y: 60, w: 40, h: 12 } }]);
  });

  it.each([
    ['OCR', { ocr: { read: async () => Promise.reject(new Error('tesseract crashed')) } as OcrEngine }],
    ['QR', { qr: { detect: async () => Promise.reject(new Error('zxing crashed')) } as QrDetector }],
    ['NER on OCR text', {
      ocr: { read: async () => [ocrWord('x', 0)] } as OcrEngine,
      ner: { tag: async () => Promise.reject(new Error('ner crashed')) } as PiiNer,
    }],
  ])('withholds the image as detector_failed when %s fails, and caches/sends nothing (§6.4.6)', async (_name, opts) => {
    const { pipeline, cache, deps, sendable, bitmap } = setup({}, opts);
    await expect(pipeline.process(CTX, REF, new ArrayBuffer(4))).resolves.toMatchObject({ outcome: 'detector_failed' });
    expect(deps.redactAndEncode).not.toHaveBeenCalled();
    expect(cache.records.size).toBe(0);
    expect(sendable.forSession('s').size).toBe(0);
    expect(bitmap.closed).toBe(true);
  });

  it('logs a pooled detector\'s queue wait as queue_ms on its record (M10, §9.6)', async () => {
    const ocr: OcrEngine = {
      read: vi.fn(async (_img, options) => {
        options?.onQueueWait?.(120);
        return [];
      }),
    };
    const { pipeline, records } = setup({}, { ocr });
    await pipeline.process(CTX, REF, new ArrayBuffer(4));
    expect(records.find((r) => r.op === 'image.ocr')?.queue_ms).toBe(120);
    // A detector that doesn't report a wait leaves the field out.
    expect(records.find((r) => r.op === 'image.face')?.queue_ms).toBeUndefined();
  });

  it('closes the decoded pixels when done', async () => {
    const { pipeline, bitmap } = setup();
    await pipeline.process(CTX, REF, new ArrayBuffer(4));
    expect(bitmap.closed).toBe(true);
  });

  it('falls back to a host fetch when the content script had no pixels, keeping HTTP validators', async () => {
    const { pipeline, cache, deps } = setup();
    await pipeline.process(CTX, REF);
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
    await expect(pipeline.process(CTX, REF)).resolves.toEqual({ node_id: 'n1', outcome: 'unreadable' });
    expect(records.find((r) => r.op === 'image.acquire')).toMatchObject({ outcome: 'fail', reason: 'unreadable' });
    expect(cache.records.size).toBe(0);
  });

  it('withholds the image as unreadable when decoding fails', async () => {
    const { pipeline } = setup({
      decode: vi.fn(async () => {
        throw new ReasonCodeError('unreadable');
      }),
    });
    await expect(pipeline.process(CTX, REF, new ArrayBuffer(4))).resolves.toMatchObject({ outcome: 'unreadable' });
  });

  it('withholds the image as detector_failed when face detection throws, and caches nothing (§6.4.6)', async () => {
    const failing: FaceDetector = {
      detect: vi.fn(async () => {
        throw new Error('wasm crashed');
      }),
    };
    const { pipeline, cache, deps, bitmap } = setup({}, { faces: failing });
    await expect(pipeline.process(CTX, REF, new ArrayBuffer(4))).resolves.toMatchObject({ outcome: 'detector_failed' });
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
    await expect(pipeline.process(CTX, REF, new ArrayBuffer(4))).resolves.toMatchObject({ outcome: 'detector_failed' });
    expect(cache.records.size).toBe(0);
  });

  it('does not cache when a detector is running on its fallback (no detector_set_version)', async () => {
    const { pipeline, cache } = setup({ detectorSetVersion: async () => undefined });
    await pipeline.process(CTX, REF, new ArrayBuffer(4));
    expect(cache.records.size).toBe(0);
  });

  it('never caches inline (data:/blob:) images and derives their id from the pixel hash (§6.3)', async () => {
    const { pipeline, cache } = setup();
    const result = await pipeline.process(CTX, { ...REF, src: 'data:image/png;base64,AAAA' }, new ArrayBuffer(4));
    expect(result.img_id).toBe(`px-${'h'.repeat(32)}`);
    expect(cache.records.size).toBe(0);
  });
});

describe('image pipeline: lookup + cache (§6.6)', () => {
  it('reports a miss (logged) and asks for pixels the first time', async () => {
    const { pipeline, records } = setup();
    await expect(pipeline.lookup(CTX, [REF])).resolves.toEqual([{ node_id: 'n1', status: 'need_pixels' }]);
    expect(ops(records)).toContain('image.cache_miss');
  });

  it('answers a fresh hit from the cache without pixels or models (logged)', async () => {
    const { pipeline, records, face } = setup();
    await pipeline.process(CTX, REF, new ArrayBuffer(4));
    vi.mocked(face.detect).mockClear();

    const [result] = await pipeline.lookup(CTX, [REF]);
    expect(result).toMatchObject({ status: 'done', outcome: 'ok' });
    expect(ops(records)).toContain('image.cache_hit');
    expect(face.detect).not.toHaveBeenCalled();
  });

  it('a fresh hit makes the cached redacted image sendable for this session\'s step', async () => {
    const { pipeline, sendable } = setup();
    await pipeline.process(CTX, REF, new ArrayBuffer(4));
    sendable.beginObservation('s');
    await pipeline.lookup(CTX, [REF]);
    expect(sendable.forSession('s').get('n1')?.blob.type).toBe('image/jpeg');
  });

  it('treats a fresh record without a redacted image as a miss (M8 Noticed #4)', async () => {
    const { pipeline, cache, records } = setup();
    await pipeline.process(CTX, REF, new ArrayBuffer(4));
    for (const record of cache.records.values()) delete record.redacted_image;
    const [result] = await pipeline.lookup(CTX, [REF]);
    expect(result?.status).toBe('need_pixels');
    expect(ops(records)).not.toContain('image.cache_hit');
  });

  it('a 304 for a record without a redacted image asks for pixels instead of answering', async () => {
    const { pipeline, cache, deps, advance } = setup();
    await pipeline.process(CTX, REF);
    for (const record of cache.records.values()) delete record.redacted_image;
    advance(CACHE_TTL_MS + 1);
    vi.mocked(deps.fetchImage).mockResolvedValueOnce({ notModified: true });
    const [result] = await pipeline.lookup(CTX, [REF]);
    expect(result?.status).toBe('need_pixels');
  });

  it('always asks for pixels for inline images', async () => {
    const { pipeline } = setup();
    const [result] = await pipeline.lookup(CTX, [{ ...REF, src: 'blob:https://example.com/1' }]);
    expect(result?.status).toBe('need_pixels');
  });

  it('past the TTL with validators: a 304 bumps validated_at without re-running models', async () => {
    const { pipeline, cache, deps, advance, face } = setup();
    await pipeline.process(CTX, REF); // fetch-acquired, etag "e1"
    vi.mocked(face.detect).mockClear();
    advance(CACHE_TTL_MS + 1);
    vi.mocked(deps.fetchImage).mockResolvedValueOnce({ notModified: true });

    const [result] = await pipeline.lookup(CTX, [REF]);
    expect(result?.status).toBe('done');
    expect(deps.fetchImage).toHaveBeenLastCalledWith(SRC, { etag: '"e1"', last_modified: undefined });
    const [record] = cache.records.values();
    expect(record?.validated_at).toBe(1_000_000 + CACHE_TTL_MS + 1);
    expect(face.detect).not.toHaveBeenCalled();
  });

  it('past the TTL with validators: a 200 with the same pixels bumps without re-running models', async () => {
    const { pipeline, advance, face } = setup();
    await pipeline.process(CTX, REF);
    vi.mocked(face.detect).mockClear();
    advance(CACHE_TTL_MS + 1);

    const [result] = await pipeline.lookup(CTX, [REF]);
    expect(result?.status).toBe('done');
    expect(face.detect).not.toHaveBeenCalled();
  });

  it('past the TTL with validators: a 200 with different pixels reprocesses', async () => {
    const { pipeline, deps, advance, face } = setup();
    await pipeline.process(CTX, REF);
    vi.mocked(face.detect).mockClear();
    advance(CACHE_TTL_MS + 1);
    vi.mocked(deps.decode).mockResolvedValueOnce(fakeBitmap('d'.repeat(64)) as unknown as ImageBitmap);

    const [result] = await pipeline.lookup(CTX, [REF]);
    expect(result?.status).toBe('done');
    expect(face.detect).toHaveBeenCalledTimes(1);
  });

  it('past the TTL without validators (canvas-acquired): asks for pixels, then reuses the record if the hash matches', async () => {
    const { pipeline, advance, face, records } = setup();
    await pipeline.process(CTX, REF, new ArrayBuffer(4));
    vi.mocked(face.detect).mockClear();
    advance(CACHE_TTL_MS + 1);

    const [looked] = await pipeline.lookup(CTX, [REF]);
    expect(looked?.status).toBe('need_pixels');

    await pipeline.process(CTX, REF, new ArrayBuffer(4));
    expect(face.detect).not.toHaveBeenCalled();
    expect(records.filter((r) => r.op === 'image.revalidate').at(-1)?.outcome).toBe('ok');
  });

  it('a revalidation that fails falls back to asking for pixels', async () => {
    const { pipeline, deps, advance } = setup();
    await pipeline.process(CTX, REF);
    advance(CACHE_TTL_MS + 1);
    vi.mocked(deps.fetchImage).mockRejectedValueOnce(new ReasonCodeError('unreadable'));

    const [result] = await pipeline.lookup(CTX, [REF]);
    expect(result?.status).toBe('need_pixels');
  });

  it('keys the cache by detector_set_version, so a detector change is a miss', async () => {
    let version = VERSION;
    const { pipeline } = setup({ detectorSetVersion: async () => version });
    await pipeline.process(CTX, REF, new ArrayBuffer(4));
    version = 'face=face/stronger;ocr=ocr/test;qr=qr/test';
    const [result] = await pipeline.lookup(CTX, [REF]);
    expect(result?.status).toBe('need_pixels');
  });
});
