// M8 done-when (§6.1-§6.3, §6.6): face fixtures are redacted, unreadable
// images are withheld with a marker, a second observation hits the cache,
// and the image cache holds no raw bytes. Driven by the same
// __EDWARD_E2E__ observe-on-load hook as canary.spec.ts; the compute host's
// IndexedDB (logs + image cache) is read from an extension page, which
// shares the extension origin with the offscreen document.

import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import type { AssembleResult } from '../../src/agent/assemble';
import { computeImgId } from '../../src/image/imgId';
import type { LogRecord } from '../../src/logging/schema';
import { expect, test } from './fixtures';
import { startStaticServer } from './staticServer';

const FIXTURES_ROOT = path.resolve(import.meta.dirname, '../fixtures');
// Longer than canary.spec.ts's default: the first observation also cold-loads
// the MediaPipe wasm + BlazeFace into every vision worker.
const OBSERVE_TIMEOUT_MS = 30_000;
// The logger flushes its ring buffer to IndexedDB every 5s (§11.2).
const LOG_FLUSH_WAIT_MS = 5_500;

async function observe(page: Page, url: string): Promise<AssembleResult> {
  await page.goto(url);
  const handle = await page.waitForFunction(() => document.documentElement.dataset.edwardObservation, undefined, {
    timeout: OBSERVE_TIMEOUT_MS,
  });
  return JSON.parse((await handle.jsonValue()) as string) as AssembleResult;
}

async function extensionPage(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/offscreen.html`);
  return page;
}

function readLogRecords(page: Page): Promise<LogRecord[]> {
  return page.evaluate(
    () =>
      new Promise<LogRecord[]>((resolve, reject) => {
        const openReq = indexedDB.open('edward-logs', 1);
        openReq.onsuccess = () => {
          const req = openReq.result.transaction('records', 'readonly').objectStore('records').getAll();
          req.onsuccess = () => resolve(req.result as LogRecord[]);
          req.onerror = () => reject(req.error ?? new Error('getAll failed'));
        };
        openReq.onerror = () => reject(openReq.error ?? new Error('indexedDB.open failed'));
      }),
  );
}

interface CacheInspection {
  keys: string[];
  img_id: string;
  raw_sha256: unknown;
  redaction_counts: { faces: number; text: number; codes: number };
  // Every field whose value is binary (Blob/ArrayBuffer/typed array).
  binaryFields: string[];
}

// Opens the image cache the same way src/image/cache.ts does, and inspects
// every record's field names and which fields hold binary data.
function inspectImageCache(page: Page): Promise<CacheInspection[]> {
  return page.evaluate(async () => {
    const records = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const openReq = indexedDB.open('edward-image-cache', 1);
      openReq.onsuccess = () => {
        const req = openReq.result.transaction('images', 'readonly').objectStore('images').getAll();
        req.onsuccess = () => resolve(req.result as Record<string, unknown>[]);
        req.onerror = () => reject(req.error ?? new Error('getAll failed'));
      };
      openReq.onerror = () => reject(openReq.error ?? new Error('indexedDB.open failed'));
    });

    return Promise.all(
      records.map(async (record) => {
        const binaryFields = Object.entries(record)
          .filter(([, v]) => v instanceof Blob || v instanceof ArrayBuffer || ArrayBuffer.isView(v))
          .map(([k]) => k);

        return {
          keys: Object.keys(record).filter((k) => record[k] !== undefined),
          img_id: record.img_id as string,
          raw_sha256: record.raw_sha256,
          redaction_counts: record.redaction_counts as CacheInspection['redaction_counts'],
          binaryFields,
        };
      }),
    );
  });
}

function imageNode(result: AssembleResult, predicate: (n: { tag: string; image?: string }) => boolean) {
  if (result.status !== 'ok') throw new Error('observation blocked');
  return result.observation.dom.filter((n) => n.image !== undefined && predicate(n));
}

test('face fixtures are redacted and cached; a second observation hits the cache; no raw bytes are stored', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(90_000);
  const server = await startStaticServer(FIXTURES_ROOT);
  try {
    const page = await context.newPage();
    const first = await observe(page, `${server.url}pages/images.html`);
    expect(first.status).toBe('ok');
    if (first.status !== 'ok') throw new Error('blocked');

    // M8 plan decision: nothing is sent until OCR/QR exist (M9) -- every
    // processed image is withheld with a marker, never silently dropped.
    const images = imageNode(first, () => true);
    expect(images).toHaveLength(6);
    expect(images.every((n) => n.image_omitted === 'detector_failed')).toBe(true);
    expect(first.observation.images).toEqual([]);

    const second = await observe(page, `${server.url}pages/images.html`);
    expect(second.status).toBe('ok');
    await page.close();

    await new Promise((resolve) => setTimeout(resolve, LOG_FLUSH_WAIT_MS));
    const ext = await extensionPage(context, extensionId);
    const records = await readLogRecords(ext);
    const cache = await inspectImageCache(ext);
    await ext.close();

    const faceRecords = records.filter((r) => r.op === 'image.face');
    test.info().annotations.push({
      type: 'measurement',
      description: `image.face per fixture: ${JSON.stringify(faceRecords.map((r) => ({ ref: r.ref, faces: r.counts?.faces, ms: Math.round(r.duration_ms) })))}`,
    });

    // Natural sizes: the cartoon faces are 200x200, the synthetic photo faces 330x330.
    const FACES: [string, number][] = [
      ['face-1.png', 200],
      ['face-2.png', 200],
      ['face-3.png', 330],
      ['face-4.png', 330],
    ];
    const faceIds = await Promise.all(FACES.map(([f, side]) => computeImgId(`${server.url}assets/${f}`, side, side)));

    // Faces found, and a solid-fill box painted over each, per face fixture.
    // (The painted output itself isn't observable here: M8 never sends or
    // persists a withheld image's pixels. Its correctness is unit-tested in
    // tests/unit/image/redact.test.ts and was inspected by eye during M8 --
    // see the M8 Log.)
    for (const img_id of faceIds) {
      const detection = records.find((r) => r.op === 'image.face' && r.ref === img_id);
      expect(detection?.outcome, `image.face for ${img_id}`).toBe('ok');
      expect(detection?.counts?.faces, `faces found in ${img_id}`).toBeGreaterThanOrEqual(1);

      const redaction = records.find((r) => r.op === 'image.redact' && r.ref === img_id);
      expect(redaction?.outcome, `image.redact for ${img_id}`).toBe('ok');
      expect(redaction?.counts?.faces, `boxes painted in ${img_id}`).toBeGreaterThanOrEqual(1);

      expect(cache.find((c) => c.img_id === img_id)?.redaction_counts.faces).toBeGreaterThanOrEqual(1);
    }

    // Second observation: answered from the cache, logged as hits.
    for (const img_id of faceIds) {
      expect(records.some((r) => r.op === 'image.cache_hit' && r.ref === img_id), `cache hit for ${img_id}`).toBe(true);
    }

    // §6.6: no raw bytes. Every record's fields are §6.6's record (+ the
    // documented bookkeeping fields), and -- since every M8 image is withheld
    // pending OCR/QR -- no record holds any pixels at all, not even redacted
    // ones (a face-redacted image may still show text PII).
    const allowed = new Set([
      'key',
      'img_id',
      'detector_set_version',
      'acquired_via',
      'raw_sha256',
      'etag',
      'last_modified',
      'redacted_image',
      'redaction_counts',
      'created_at',
      'validated_at',
    ]);
    expect(cache.length).toBeGreaterThanOrEqual(6);
    for (const record of cache) {
      expect(record.keys.every((k) => allowed.has(k)), `fields: ${record.keys.join(',')}`).toBe(true);
      expect(record.binaryFields).toEqual([]);
      expect(record.raw_sha256).toMatch(/^[0-9a-f]{64}$/);
    }

  } finally {
    await server.close();
  }
});

test('unreadable and too-small images are withheld with a marker; tainted images fall back to a host fetch', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(60_000);
  const server = await startStaticServer(FIXTURES_ROOT);
  // A second origin (another port) serving the same files without CORS
  // headers: the page's canvas read is tainted (§6.2.1 fails), so the
  // compute host fetches it itself (§6.2.2). On Chromium that fetch succeeds
  // without any extra permission request: the content script's <all_urls>
  // match pattern already grants the extension host access (found in M8).
  const crossOrigin = await startStaticServer(FIXTURES_ROOT);
  try {
    const page = await context.newPage();
    const result = await observe(page, `${server.url}pages/images-unreadable.html?xo=${encodeURIComponent(crossOrigin.url)}`);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('blocked');

    const byName = new Map(
      result.observation.dom.filter((n) => n.image !== undefined).map((n) => [n.content.accessible_name ?? '', n.image_omitted]),
    );
    expect(Object.fromEntries(byName)).toEqual({
      'missing image': 'unreadable', // 404: no pixels via canvas or fetch (§6.2.3)
      'not an image': 'unreadable', // fetched fine, but doesn't decode (§6.2.3)
      // Acquired through the host fetch fallback and face-processed, then
      // withheld by the M8 send gate (OCR/QR arrive in M9).
      'cross-origin image': 'detector_failed',
      'tiny image': 'too_small', // §6.1 size floor
      'no source': 'unreadable',
    });
    expect(result.observation.images).toEqual([]);
    await page.close();

    // The cross-origin image really did take the fallback path: the content
    // script's canvas read failed as tainted, and the host fetch succeeded.
    await new Promise((resolve) => setTimeout(resolve, LOG_FLUSH_WAIT_MS));
    const ext = await extensionPage(context, extensionId);
    const records = await readLogRecords(ext);
    await ext.close();
    const xoNode = result.observation.dom.find((n) => n.content.accessible_name === 'cross-origin image');
    const acquires = records.filter((r) => r.op === 'image.acquire' && r.ref === xoNode?.node_id && r.session_id === result.observation.session_id);
    expect(acquires.map((r) => [r.outcome, r.reason ?? null])).toEqual([
      ['fail', 'cors_blocked'],
      ['ok', null],
    ]);

    // §6.1 size floor: the tiny image is logged as a skipped acquisition.
    const tinyNode = result.observation.dom.find((n) => n.content.accessible_name === 'tiny image');
    expect(
      records.some(
        (r) => r.op === 'image.acquire' && r.ref === tinyNode?.node_id && r.outcome === 'skipped' && r.reason === 'too_small',
      ),
    ).toBe(true);
  } finally {
    await server.close();
    await crossOrigin.close();
  }
});

// /milestone-check M8 finding: MediaPipe Tasks Vision uploads usage metrics
// to odml.pa.googleapis.com every 60s. The model-worker egress guard
// (src/models/providers/egressGuard.ts) must refuse that request and log it.
// Waits out MediaPipe's 60s flush interval, so this is the slowest e2e test.
test('model workers cannot phone home: MediaPipe’s metrics upload is refused and logged', async ({ context, extensionId }) => {
  test.setTimeout(150_000);
  // Backstop only, so this test can never leak even if the guard regressed.
  // Counted, and expected to stay at zero: the guard refuses the request
  // inside the worker before it reaches the network stack.
  let reachedNetwork = 0;
  await context.route(/googleapis\.com/, (route) => {
    reachedNetwork++;
    return route.abort();
  });

  const server = await startStaticServer(FIXTURES_ROOT);
  try {
    const page = await context.newPage();
    const result = await observe(page, `${server.url}pages/images.html`);
    expect(result.status).toBe('ok');
    // MediaPipe's flush timer is 60s from task creation; wait past it plus
    // one logger flush.
    await new Promise((resolve) => setTimeout(resolve, 65_000 + LOG_FLUSH_WAIT_MS));
    await page.close();

    const ext = await extensionPage(context, extensionId);
    const records = await readLogRecords(ext);
    await ext.close();

    const blocked = records.filter((r) => r.reason === 'egress_blocked');
    test.info().annotations.push({
      type: 'measurement',
      description: `egress_blocked records: ${JSON.stringify(blocked.map((r) => [r.op, r.model_id]))}; requests reaching the network: ${reachedNetwork}`,
    });
    expect(blocked.some((r) => r.op === 'image.face' && r.model_id === 'face/blazeface-mediapipe')).toBe(true);
    expect(reachedNetwork).toBe(0);
  } finally {
    await server.close();
  }
});
