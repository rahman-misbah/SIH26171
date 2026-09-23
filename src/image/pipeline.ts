// §6: the compute-host image pipeline. Two entry points, matching the two
// messages the content script sends (src/platform/messages.ts):
//
// - lookup(): cheap, no pixels. Computes img_id (§6.3), checks the cache
//   (§6.6) and answers "done" (fresh hit, or revalidated by a conditional
//   request) or "need_pixels". This keeps a cache hit from ever paying the
//   content script's canvas read + messaging cost (§15 skip work).
// - process(): given pixels from the content script's canvas read (§6.2.1)
//   or, failing that, fetched here (§6.2.2) -> hash -> (re-hash cache
//   check) -> face + OCR + QR in parallel -> OCR text through §7 -> one
//   solid-fill redaction of every face, code and PII word -> downscale/
//   encode -> cache.
//
// §6.4: an image is sendable only once all three detectors have run on it;
// any failure (including the OCR text's NER pass) withholds it as
// `detector_failed` and nothing is cached (§6.4.6). A sendable image's
// redacted output goes into the per-session SendableImageStore for §14.3
// selection, and into the cache record. Raw pixels are held only for the
// duration of process() and closed in its `finally` (§2.8).

import type { ImageKind } from '@/dom/types';
import { ReasonCodeError } from '@/logging';
import type { LogMeta, LogRecord, OpName, ReasonCode, RuntimeLogger } from '@/logging';
import type { Box, FaceDetector, OcrEngine, PiiNer, QrDetector } from '@/models/capabilities';
import type { TokenMapImpl } from '@/sanitize/tokenMap';
import { cacheKey, decideCache, revalidationOutcome } from './cachePolicy';
import type { FetchResult, Validators } from './fetchImage';
import { computeImgId, isInlineSource, pixelImgId } from './imgId';
import { findOcrRedactions } from './ocrRedact';
import type { SendableImageStore } from './sendable';
import type { ImageCacheRecord, ImageCacheStore, ImageOutcome } from './types';

export interface ImageRef {
  node_id: string;
  kind: ImageKind;
  src: string;
  natural_w: number;
  natural_h: number;
}

export type LookupResult =
  | { node_id: string; status: 'need_pixels' }
  | { node_id: string; status: 'done'; img_id: string; outcome: ImageOutcome };

export interface ProcessResult {
  node_id: string;
  img_id?: string;
  outcome: ImageOutcome;
}

// Who is asking: the session (token map, sendable store) and the page origin
// OCR PII is tokenized under (§7.6: tokens are per session and origin).
export interface ImageRequestContext {
  session_id: string;
  origin: string;
}

export interface ImagePipelineDeps {
  cache: ImageCacheStore;
  sendable: SendableImageStore;
  logger: RuntimeLogger;
  now(): number;
  faceDetector(): Promise<FaceDetector>;
  ocrEngine(): Promise<OcrEngine>;
  qrDetector(): Promise<QrDetector>;
  ner(): Promise<PiiNer>;
  tokenMap(session_id: string): TokenMapImpl;
  // §6.6: undefined when a detector stage is running on its fail-closed
  // fallback -- nothing is cached then (there's no trustworthy result).
  detectorSetVersion(): Promise<string | undefined>;
  fetchImage(src: string, validators?: Validators): Promise<FetchResult>;
  decode(bytes: Blob): Promise<ImageBitmap>;
  hashPixels(image: ImageBitmap): Promise<string>;
  redactAndEncode(image: ImageBitmap, boxes: Box[]): Promise<{ blob: Blob; painted: number }>;
}

export interface ImagePipeline {
  lookup(ctx: ImageRequestContext, images: ImageRef[]): Promise<LookupResult[]>;
  process(ctx: ImageRequestContext, image: ImageRef, pixels?: ArrayBuffer): Promise<ProcessResult>;
}

function reasonOf(error: unknown, fallback: ReasonCode): ReasonCode {
  return error instanceof ReasonCodeError ? error.reason : fallback;
}

export function createImagePipeline(deps: ImagePipelineDeps): ImagePipeline {
  const { cache, logger, sendable } = deps;

  function stamp(): number {
    return performance.timeOrigin + performance.now();
  }

  function recordInstant(op: OpName, meta: LogMeta, outcome: LogRecord['outcome'], reason?: ReasonCode): void {
    const t = stamp();
    logger.record({ ...meta, op, t_start: t, t_end: t, duration_ms: 0, outcome, reason });
  }

  // Like logger.timed(), but lets the call site attach counts that are only
  // known once `fn` has finished (e.g. how many faces were found), and maps
  // failures to a stage-specific default ReasonCode instead of 'unknown'.
  async function measured<T>(
    op: OpName,
    meta: LogMeta,
    failReason: ReasonCode,
    fn: () => Promise<T>,
    countsOf?: (value: T) => LogRecord['counts'],
  ): Promise<T> {
    const t_start = stamp();
    try {
      const value = await fn();
      const t_end = stamp();
      logger.record({ ...meta, op, t_start, t_end, duration_ms: t_end - t_start, outcome: 'ok', counts: countsOf?.(value) ?? meta.counts });
      return value;
    } catch (error) {
      const t_end = stamp();
      logger.record({ ...meta, op, t_start, t_end, duration_ms: t_end - t_start, outcome: 'fail', reason: reasonOf(error, failReason) });
      throw error;
    }
  }

  // A cached record can answer for this observation only if it still holds
  // the redacted output (records from before M9 never did -- CLAUDE.md: no
  // unredacted-PII pixels persisted). Without it the caller reprocesses.
  function useRecord(ctx: ImageRequestContext, node_id: string, record: ImageCacheRecord): boolean {
    if (!record.redacted_image) return false;
    sendable.put(ctx.session_id, node_id, { img_id: record.img_id, blob: record.redacted_image });
    return true;
  }

  async function bump(record: ImageCacheRecord): Promise<void> {
    await cache.put({ ...record, validated_at: deps.now() });
  }

  // Detector stages -> OCR text sanitization -> redaction -> (cache). Takes
  // ownership of nothing: the caller closes `image`.
  async function runStages(
    ctx: ImageRequestContext,
    node_id: string,
    image: ImageBitmap,
    ids: { img_id: string; raw_sha256: string; version: string | undefined; cacheable: boolean },
    acquired: { via: 'canvas' | 'fetch'; etag?: string; last_modified?: string },
  ): Promise<ImageOutcome> {
    const meta = { session_id: ctx.session_id, ref: ids.img_id };
    const input = { bitmap: image };

    let faceBoxes: Box[];
    let textBoxes: Box[];
    let codeBoxes: Box[];
    try {
      // §6.4.1-3 run in parallel on the same pixels (§15); each detector
      // lives in its own worker pool. Any rejection withholds the image.
      const [faces, words, codes] = await Promise.all([
        deps.faceDetector().then((d) => measured('image.face', meta, 'detector_failed', () => d.detect(input), (f) => ({ faces: f.length }))),
        deps.ocrEngine().then((d) => measured('image.ocr', meta, 'detector_failed', () => d.read(input), (w) => ({ words: w.length }))),
        deps.qrDetector().then((d) => measured('image.qr', meta, 'detector_failed', () => d.detect(input), (c) => ({ codes: c.length }))),
      ]);
      // §6.4.4: OCR words through the §7 path; only PII words are redacted.
      const ocr = await findOcrRedactions(words, {
        ner: await deps.ner(),
        tokenMap: deps.tokenMap(ctx.session_id),
        origin: ctx.origin,
        img_id: ids.img_id,
      });
      // §6.4.1/§6.4.3: every face and every code box, whatever its bucket.
      faceBoxes = faces.map((f) => f.box);
      textBoxes = ocr.boxes;
      codeBoxes = codes.map((c) => c.box);
    } catch {
      return 'detector_failed'; // §6.4.6
    }

    let encoded: { blob: Blob; painted: number };
    try {
      encoded = await measured(
        'image.redact',
        { ...meta, counts: { faces: faceBoxes.length, words: textBoxes.length, codes: codeBoxes.length } },
        'detector_failed',
        () => deps.redactAndEncode(image, [...faceBoxes, ...textBoxes, ...codeBoxes]),
        (r) => ({ faces: faceBoxes.length, words: textBoxes.length, codes: codeBoxes.length, bytes: r.blob.size }),
      );
    } catch {
      return 'detector_failed';
    }

    sendable.put(ctx.session_id, node_id, { img_id: ids.img_id, blob: encoded.blob });

    if (ids.cacheable && ids.version) {
      const now = deps.now();
      try {
        await cache.put({
          key: cacheKey(ids.img_id, ids.version),
          img_id: ids.img_id,
          detector_set_version: ids.version,
          acquired_via: acquired.via,
          raw_sha256: ids.raw_sha256,
          etag: acquired.etag,
          last_modified: acquired.last_modified,
          redacted_image: encoded.blob,
          redaction_counts: { faces: faceBoxes.length, text: textBoxes.length, codes: codeBoxes.length },
          created_at: now,
          validated_at: now,
        });
      } catch {
        // A failed cache write only costs a future re-run; the redacted
        // result itself is still valid for this observation.
      }
    }

    return 'ok';
  }

  async function lookupOne(ctx: ImageRequestContext, ref: ImageRef): Promise<LookupResult> {
    const needPixels: LookupResult = { node_id: ref.node_id, status: 'need_pixels' };
    // §6.3: inline sources are never cached -- always processed fresh.
    if (isInlineSource(ref.src)) return needPixels;

    const img_id = await computeImgId(ref.src, ref.natural_w, ref.natural_h);
    const version = await deps.detectorSetVersion();
    if (!version) return needPixels; // process() will fail closed

    const decision = decideCache(await cache.get(cacheKey(img_id, version)), deps.now());
    const meta = { session_id: ctx.session_id, ref: img_id };

    if (decision.kind === 'miss') {
      recordInstant('image.cache_miss', meta, 'ok');
      return needPixels;
    }
    if (decision.kind === 'fresh') {
      if (!useRecord(ctx, ref.node_id, decision.record)) {
        recordInstant('image.cache_miss', meta, 'ok');
        return needPixels;
      }
      const counts = decision.record.redaction_counts;
      recordInstant('image.cache_hit', { ...meta, counts: { faces: counts.faces, words: counts.text, codes: counts.codes } }, 'ok');
      return { node_id: ref.node_id, status: 'done', img_id, outcome: 'ok' };
    }
    // Stale without validators: only a pixel re-read can tell whether it
    // changed -- that's process()'s re-hash check.
    if (decision.via === 'rehash') return needPixels;

    // Stale with validators: §6.6 conditional request first.
    const { record } = decision;
    try {
      const outcome = await measured('image.revalidate', meta, 'unreadable', async (): Promise<ImageOutcome | 'need_pixels'> => {
        const fetched = await deps.fetchImage(ref.src, { etag: record.etag, last_modified: record.last_modified });
        if (fetched.notModified) {
          if (!useRecord(ctx, ref.node_id, record)) return 'need_pixels';
          await bump(record);
          return 'ok';
        }
        const image = await deps.decode(fetched.blob);
        try {
          const raw_sha256 = await deps.hashPixels(image);
          if (revalidationOutcome(record, { raw_sha256 }) === 'bump' && useRecord(ctx, ref.node_id, record)) {
            await bump({ ...record, etag: fetched.etag, last_modified: fetched.last_modified });
            return 'ok';
          }
          return runStages(
            ctx,
            ref.node_id,
            image,
            { img_id, raw_sha256, version, cacheable: true },
            { via: 'fetch', etag: fetched.etag, last_modified: fetched.last_modified },
          );
        } finally {
          image.close();
        }
      });
      if (outcome === 'need_pixels') return needPixels;
      return { node_id: ref.node_id, status: 'done', img_id, outcome };
    } catch {
      // Revalidation itself failed: fall back to a normal acquisition.
      return needPixels;
    }
  }

  async function acquire(
    ctx: ImageRequestContext,
    ref: ImageRef,
    pixels: ArrayBuffer | undefined,
  ): Promise<{ image: ImageBitmap; via: 'canvas' | 'fetch'; etag?: string; last_modified?: string }> {
    // §6.2.1: pixels the content script read via canvas. Its own read is
    // timed content-side; this only decodes.
    if (pixels) return { image: await deps.decode(new Blob([pixels])), via: 'canvas' };

    // §6.2.2: fall back to fetching here. §6.2.3: failure -> unreadable.
    return measured('image.acquire', { session_id: ctx.session_id, ref: ref.node_id }, 'unreadable', async () => {
      const fetched = await deps.fetchImage(ref.src);
      if (fetched.notModified) throw new ReasonCodeError('unreadable'); // no validators were sent
      return { image: await deps.decode(fetched.blob), via: 'fetch' as const, etag: fetched.etag, last_modified: fetched.last_modified };
    });
  }

  async function processOne(ctx: ImageRequestContext, ref: ImageRef, pixels?: ArrayBuffer): Promise<ProcessResult> {
    let acquired: Awaited<ReturnType<typeof acquire>>;
    try {
      acquired = await acquire(ctx, ref, pixels);
    } catch {
      return { node_id: ref.node_id, outcome: 'unreadable' };
    }

    const { image } = acquired;
    try {
      let raw_sha256: string;
      try {
        raw_sha256 = await deps.hashPixels(image);
      } catch {
        return { node_id: ref.node_id, outcome: 'unreadable' };
      }
      const inline = isInlineSource(ref.src);
      const img_id = inline ? pixelImgId(raw_sha256) : await computeImgId(ref.src, ref.natural_w, ref.natural_h);
      const version = await deps.detectorSetVersion();

      // §6.6 re-hash revalidation: a stale (or concurrently written) record
      // whose raw pixels are unchanged is reused without re-running models.
      if (!inline && version) {
        const record = await cache.get(cacheKey(img_id, version));
        if (record && revalidationOutcome(record, { raw_sha256 }) === 'bump' && useRecord(ctx, ref.node_id, record)) {
          recordInstant('image.revalidate', { session_id: ctx.session_id, ref: img_id }, 'ok');
          await bump(record);
          return { node_id: ref.node_id, img_id, outcome: 'ok' };
        }
      }

      const outcome = await runStages(ctx, ref.node_id, image, { img_id, raw_sha256, version, cacheable: !inline }, acquired);
      return { node_id: ref.node_id, img_id, outcome };
    } finally {
      image.close(); // §2.8: raw pixels live only while being processed
    }
  }

  return {
    lookup(ctx, images) {
      return Promise.all(images.map((ref) => lookupOne(ctx, ref)));
    },
    process: processOne,
  };
}
