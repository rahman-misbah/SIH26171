// §6: the compute-host image pipeline. Two entry points, matching the two
// messages the content script sends (src/platform/messages.ts):
//
// - lookup(): cheap, no pixels. Computes img_id (§6.3), checks the cache
//   (§6.6) and answers "done" (fresh hit, or revalidated by a conditional
//   request) or "need_pixels". This keeps a cache hit from ever paying the
//   content script's canvas read + messaging cost (§15 skip work).
// - process(): given pixels from the content script's canvas read (§6.2.1)
//   or, failing that, fetched here (§6.2.2) -> hash -> (re-hash cache
//   check) -> face -> redact -> downscale/encode -> cache.
//
// §6.4 requires face + OCR + QR before an image may be sent. M8 implements
// the face stage only, so every image is withheld as `detector_failed` by
// the send gate below until M9 adds the OCR/QR stages (agreed in the M8
// plan) -- face detection, redaction and caching still run (verified through
// the logs and the cache), but a withheld image's pixels are never cached,
// even redacted: they may still hold text/QR PII (see ImageCacheRecord).
// Raw pixels are held only for the duration of process() and closed in its
// `finally` (§2.8).

import type { ImageKind } from '@/dom/types';
import { ReasonCodeError } from '@/logging';
import type { LogMeta, LogRecord, OpName, ReasonCode, RuntimeLogger } from '@/logging';
import type { Box, Capability, FaceDetector } from '@/models/capabilities';
import { cacheKey, decideCache, revalidationOutcome } from './cachePolicy';
import type { FetchResult, Validators } from './fetchImage';
import { computeImgId, isInlineSource, pixelImgId } from './imgId';
import type { ImageCacheRecord, ImageCacheStore, ImageOutcome } from './types';

// §6.4 steps 1-3. Every one must have run before an image may be sent.
const REQUIRED_FOR_SEND: Capability[] = ['face', 'ocr', 'qr'];
// The detector stages this pipeline actually runs (M9 adds 'ocr', 'qr').
const IMPLEMENTED_STAGES: Capability[] = ['face'];

const STAGE_OP: Record<Capability, OpName | undefined> = {
  face: 'image.face',
  ocr: 'image.ocr',
  qr: 'image.qr',
  ner: undefined,
};

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

export interface ImagePipelineDeps {
  cache: ImageCacheStore;
  logger: RuntimeLogger;
  now(): number;
  faceDetector(): Promise<FaceDetector>;
  // §6.6: undefined when a detector stage is running on its fail-closed
  // fallback -- nothing is cached then (there's no trustworthy result).
  detectorSetVersion(): Promise<string | undefined>;
  fetchImage(src: string, validators?: Validators): Promise<FetchResult>;
  decode(bytes: Blob): Promise<ImageBitmap>;
  hashPixels(image: ImageBitmap): Promise<string>;
  redactAndEncode(image: ImageBitmap, boxes: Box[]): Promise<{ blob: Blob; painted: number }>;
  // Override of REQUIRED_FOR_SEND, for unit tests only (to exercise the
  // "passed the gate" path before M9's stages exist).
  requiredForSend?: Capability[];
}

export interface ImagePipeline {
  lookup(session_id: string, images: ImageRef[]): Promise<LookupResult[]>;
  process(session_id: string, image: ImageRef, pixels?: ArrayBuffer): Promise<ProcessResult>;
}

function reasonOf(error: unknown, fallback: ReasonCode): ReasonCode {
  return error instanceof ReasonCodeError ? error.reason : fallback;
}

export function createImagePipeline(deps: ImagePipelineDeps): ImagePipeline {
  const { cache, logger } = deps;
  const requiredForSend = deps.requiredForSend ?? REQUIRED_FOR_SEND;

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

  // §6.4 / §2.1: an image leaves the device only once every required
  // detector has run on it. A missing stage is logged as a fail-closed
  // outcome on that stage's op, so the aggregator's fail-closed count shows it.
  function sendGate(session_id: string, img_id: string): ImageOutcome {
    const missing = requiredForSend.filter((c) => !IMPLEMENTED_STAGES.includes(c));
    for (const capability of missing) {
      const op = STAGE_OP[capability];
      if (op) recordInstant(op, { session_id, ref: img_id }, 'fail_closed', 'detector_failed');
    }
    return missing.length === 0 ? 'ok' : 'detector_failed';
  }

  async function bump(record: ImageCacheRecord): Promise<void> {
    await cache.put({ ...record, validated_at: deps.now() });
  }

  // Detector stages -> redaction -> (cache). Takes ownership of nothing: the
  // caller closes `image`.
  async function runStages(
    session_id: string,
    image: ImageBitmap,
    ids: { img_id: string; raw_sha256: string; version: string | undefined; cacheable: boolean },
    acquired: { via: 'canvas' | 'fetch'; etag?: string; last_modified?: string },
  ): Promise<ImageOutcome> {
    const meta = { session_id, ref: ids.img_id };

    let boxes: Box[];
    try {
      const face = await deps.faceDetector();
      const faces = await measured('image.face', meta, 'detector_failed', () => face.detect({ bitmap: image }), (found) => ({
        faces: found.length,
      }));
      // §6.4.1: every returned box is redacted, whatever its bucket.
      boxes = faces.map((f) => f.box);
    } catch {
      return 'detector_failed'; // §6.4.6
    }

    let encoded: { blob: Blob; painted: number };
    try {
      encoded = await measured('image.redact', meta, 'detector_failed', () => deps.redactAndEncode(image, boxes), (r) => ({
        faces: r.painted,
        bytes: r.blob.size,
      }));
    } catch {
      return 'detector_failed';
    }

    // Redaction still runs for a gated image (it's a real stage whose latency
    // M9's selection will depend on), but its output is only kept -- and
    // only ever persisted -- once the image is fully processed.
    const outcome = sendGate(session_id, ids.img_id);

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
          redacted_image: outcome === 'ok' ? encoded.blob : undefined,
          redaction_counts: { faces: encoded.painted, text: 0, codes: 0 },
          created_at: now,
          validated_at: now,
        });
      } catch {
        // A failed cache write only costs a future re-run; the redacted
        // result itself is still valid for this observation.
      }
    }

    return outcome;
  }

  async function lookupOne(session_id: string, ref: ImageRef): Promise<LookupResult> {
    const needPixels: LookupResult = { node_id: ref.node_id, status: 'need_pixels' };
    // §6.3: inline sources are never cached -- always processed fresh.
    if (isInlineSource(ref.src)) return needPixels;

    const img_id = await computeImgId(ref.src, ref.natural_w, ref.natural_h);
    const version = await deps.detectorSetVersion();
    if (!version) return needPixels; // process() will fail closed

    const decision = decideCache(await cache.get(cacheKey(img_id, version)), deps.now());
    const meta = { session_id, ref: img_id };

    if (decision.kind === 'miss') {
      recordInstant('image.cache_miss', meta, 'ok');
      return needPixels;
    }
    if (decision.kind === 'fresh') {
      recordInstant('image.cache_hit', { ...meta, counts: { faces: decision.record.redaction_counts.faces } }, 'ok');
      return { node_id: ref.node_id, status: 'done', img_id, outcome: sendGate(session_id, img_id) };
    }
    // Stale without validators: only a pixel re-read can tell whether it
    // changed -- that's process()'s re-hash check.
    if (decision.via === 'rehash') return needPixels;

    // Stale with validators: §6.6 conditional request first.
    const { record } = decision;
    try {
      const outcome = await measured('image.revalidate', meta, 'unreadable', async () => {
        const fetched = await deps.fetchImage(ref.src, { etag: record.etag, last_modified: record.last_modified });
        if (fetched.notModified) {
          await bump(record);
          return 'bumped' as const;
        }
        const image = await deps.decode(fetched.blob);
        try {
          const raw_sha256 = await deps.hashPixels(image);
          if (revalidationOutcome(record, { raw_sha256 }) === 'bump') {
            await bump({ ...record, etag: fetched.etag, last_modified: fetched.last_modified });
            return 'bumped' as const;
          }
          return runStages(
            session_id,
            image,
            { img_id, raw_sha256, version, cacheable: true },
            { via: 'fetch', etag: fetched.etag, last_modified: fetched.last_modified },
          );
        } finally {
          image.close();
        }
      });
      return { node_id: ref.node_id, status: 'done', img_id, outcome: outcome === 'bumped' ? sendGate(session_id, img_id) : outcome };
    } catch {
      // Revalidation itself failed: fall back to a normal acquisition.
      return needPixels;
    }
  }

  async function acquire(
    session_id: string,
    ref: ImageRef,
    pixels: ArrayBuffer | undefined,
  ): Promise<{ image: ImageBitmap; via: 'canvas' | 'fetch'; etag?: string; last_modified?: string }> {
    // §6.2.1: pixels the content script read via canvas. Its own read is
    // timed content-side; this only decodes.
    if (pixels) return { image: await deps.decode(new Blob([pixels])), via: 'canvas' };

    // §6.2.2: fall back to fetching here. §6.2.3: failure -> unreadable.
    return measured('image.acquire', { session_id, ref: ref.node_id }, 'unreadable', async () => {
      const fetched = await deps.fetchImage(ref.src);
      if (fetched.notModified) throw new ReasonCodeError('unreadable'); // no validators were sent
      return { image: await deps.decode(fetched.blob), via: 'fetch' as const, etag: fetched.etag, last_modified: fetched.last_modified };
    });
  }

  async function processOne(session_id: string, ref: ImageRef, pixels?: ArrayBuffer): Promise<ProcessResult> {
    let acquired: Awaited<ReturnType<typeof acquire>>;
    try {
      acquired = await acquire(session_id, ref, pixels);
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
        if (record && revalidationOutcome(record, { raw_sha256 }) === 'bump') {
          recordInstant('image.revalidate', { session_id, ref: img_id }, 'ok');
          await bump(record);
          return { node_id: ref.node_id, img_id, outcome: sendGate(session_id, img_id) };
        }
      }

      const outcome = await runStages(session_id, image, { img_id, raw_sha256, version, cacheable: !inline }, acquired);
      return { node_id: ref.node_id, img_id, outcome };
    } finally {
      image.close(); // §2.8: raw pixels live only while being processed
    }
  }

  return {
    lookup(session_id, images) {
      return Promise.all(images.map((ref) => lookupOne(session_id, ref)));
    },
    process: processOne,
  };
}
