// M8 done-when (§6.1-§6.3, §6.6): face fixtures are redacted, unreadable
// images are withheld with a marker, a second observation hits the cache,
// and the image cache holds no raw bytes. M9: images are now sent -- the
// face test checks the outgoing (and cached) redacted images themselves,
// §14.3 selection is checked on images.html, and the fetch fallback's
// private-host refusal on images-unreadable.html. Driven by the same
// __EDWARD_E2E__ observe-on-load hook as canary.spec.ts; the compute host's
// IndexedDB (logs + image cache) is read from an extension page, which
// shares the extension origin with the offscreen document.

import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import type { AssembleResult } from '../../src/agent/assemble';
import { computeImgId } from '../../src/image/imgId';
import type { LogRecord } from '../../src/logging/schema';
import { E2E_PUBLIC_HOST, expect, launchWithFaceProvider, test } from './fixtures';
import { imageBytes, type ObservedImage } from './imageForensics';
import { startStaticServer } from './staticServer';

const FIXTURES_ROOT = path.resolve(import.meta.dirname, '../fixtures');
// Longer than canary.spec.ts's default: the first observation also cold-loads
// the face models (SCRFD + BlazeFace since M12) into every vision worker.
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
  redacted_sha256?: string; // sha-256 of the stored redacted_image's bytes
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

        const blob = record.redacted_image;
        const redacted_sha256 =
          blob instanceof Blob
            ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (b) => b.toString(16).padStart(2, '0')).join('')
            : undefined;
        return {
          keys: Object.keys(record).filter((k) => record[k] !== undefined),
          img_id: record.img_id as string,
          raw_sha256: record.raw_sha256,
          redaction_counts: record.redaction_counts as CacheInspection['redaction_counts'],
          binaryFields,
          redacted_sha256,
        };
      }),
    );
  });
}

// Fraction of an image's pixels that are (near-)pure black -- what the
// solid-fill redactor paints (src/image/redact.ts). Decoded in a page, since
// Node has no image decoder.
function darkFraction(page: Page, dataUrl: string): Promise<number> {
  return page.evaluate(async (url) => {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! < 16 && data[i + 1]! < 16 && data[i + 2]! < 16) dark++;
    return dark / (data.length / 4);
  }, dataUrl);
}

function imageNode(result: AssembleResult, predicate: (n: { tag: string; image?: string }) => boolean) {
  if (result.status !== 'ok') throw new Error('observation blocked');
  return result.observation.dom.filter((n) => n.image !== undefined && predicate(n));
}

test('face fixtures are redacted, sent and cached; a second observation hits the cache; no raw bytes are stored', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(90_000);
  const server = await startStaticServer(FIXTURES_ROOT);
  try {
    const page = await context.newPage();
    const first = await observe(page, `${server.url}pages/faces.html`);
    expect(first.status).toBe('ok');
    if (first.status !== 'ok') throw new Error('blocked');

    // M9: all four faces pass face + OCR + QR and are sent (4 = the mock
    // backend's request limit).
    const images = imageNode(first, () => true);
    expect(images.map((n) => n.image_omitted)).toEqual([undefined, undefined, undefined, undefined]);
    const sent = first.observation.images as unknown as ObservedImage[];
    expect(sent).toHaveLength(4);

    // Each outgoing image carries a painted box: clearly more solid black
    // than its original. (The originals contain almost none; a face box
    // covers a large share of these close-up portraits.) M12: SCRFD alone
    // missed a close-up here, which is why the automatic face model is
    // SCRFD + BlazeFace (providers/face/union.ts).
    const FACES: [string, number][] = [
      ['face-1.png', 200],
      ['face-2.png', 200],
      ['face-3.png', 330],
      ['face-4.png', 330],
    ];
    const faceIds = await Promise.all(FACES.map(([f, side]) => computeImgId(`${server.url}assets/${f}`, side, side)));
    const darkness: Record<string, [number, number]> = {};
    for (const [i, [file]] of FACES.entries()) {
      const out = sent.find((img) => img.img_id === faceIds[i]);
      expect(out, `${file} was sent`).toBeDefined();
      const before = await darkFraction(page, `${server.url}assets/${file}`);
      const after = await darkFraction(page, `data:image/jpeg;base64,${out!.data.base64}`);
      darkness[file] = [Math.round(before * 100) / 100, Math.round(after * 100) / 100];
      expect(after - before, `${file}: painted area`).toBeGreaterThan(0.05);
    }
    test.info().annotations.push({ type: 'measurement', description: `dark-pixel fraction before/after redaction: ${JSON.stringify(darkness)}` });

    const second = await observe(page, `${server.url}pages/faces.html`);
    expect(second.status).toBe('ok');
    if (second.status !== 'ok') throw new Error('blocked');
    // Answered from the cache, and sent again from the cached redacted image.
    expect(second.observation.images).toHaveLength(4);
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

    for (const img_id of faceIds) {
      const detection = records.find((r) => r.op === 'image.face' && r.ref === img_id);
      expect(detection?.outcome, `image.face for ${img_id}`).toBe('ok');
      expect(detection?.counts?.faces, `faces found in ${img_id}`).toBeGreaterThanOrEqual(1);
      for (const op of ['image.ocr', 'image.qr', 'image.redact'] as const) {
        expect(records.find((r) => r.op === op && r.ref === img_id)?.outcome, `${op} for ${img_id}`).toBe('ok');
      }
      expect(cache.find((c) => c.img_id === img_id)?.redaction_counts.faces).toBeGreaterThanOrEqual(1);
      expect(records.some((r) => r.op === 'image.cache_hit' && r.ref === img_id), `cache hit for ${img_id}`).toBe(true);
    }

    // §6.6: no raw bytes. Every record's fields are §6.6's record (+ the
    // documented bookkeeping fields); the only binary field is
    // redacted_image, and its bytes are exactly the redacted image that was
    // sent -- not the original.
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
    const sentHashes = new Set(sent.map((img) => createHash('sha256').update(imageBytes(img)).digest('hex')));
    for (const img_id of faceIds) {
      const record = cache.find((c) => c.img_id === img_id && c.redacted_sha256 !== undefined);
      expect(record, `cache record for ${img_id}`).toBeDefined();
      expect(record!.keys.every((k) => allowed.has(k)), `fields: ${record!.keys.join(',')}`).toBe(true);
      expect(record!.binaryFields).toEqual(['redacted_image']);
      expect(record!.raw_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(sentHashes.has(record!.redacted_sha256!), `${img_id}: cached bytes are the redacted output`).toBe(true);
    }
    for (const record of cache) {
      expect(record.keys.every((k) => allowed.has(k)), `fields: ${record.keys.join(',')}`).toBe(true);
      expect(record.binaryFields.every((f) => f === 'redacted_image')).toBe(true);
    }
  } finally {
    await server.close();
  }
});

// §14.3: more images than the backend takes. The mock backend's
// maxImagesPerRequest is 4; images.html has 7. Exactly 4 are sent, in
// priority order (in-viewport, then larger area), and the other 3 carry a
// request_limit marker -- most of them never processed at all (§6.7 send
// budget), so the observation doesn't wait on them.
test('selection: only maxImagesPerRequest images are sent, the rest are marked request_limit', async ({ context, extensionId }) => {
  test.setTimeout(90_000);
  const server = await startStaticServer(FIXTURES_ROOT);
  try {
    const page = await context.newPage();
    const result = await observe(page, `${server.url}pages/images.html`);
    await page.close();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('blocked');

    const nodes = imageNode(result, () => true);
    expect(nodes).toHaveLength(7);
    const sent = result.observation.images as unknown as ObservedImage[];
    expect(sent).toHaveLength(4);
    const sentNodes = new Set(sent.map((i) => i.node_id));
    for (const node of nodes) {
      expect(node.image_omitted, `node ${node.node_id}`).toBe(sentNodes.has(node.node_id) ? undefined : 'request_limit');
    }
    // Largest first among in-viewport images: the QR (300x300) leads.
    const bySize = [...nodes].filter((n) => n.in_viewport).sort((a, b) => b.bbox.w * b.bbox.h - a.bbox.w * a.bbox.h);
    expect(sentNodes.has(bySize[0]!.node_id)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, LOG_FLUSH_WAIT_MS));
    const ext = await extensionPage(context, extensionId);
    const records = await readLogRecords(ext);
    await ext.close();
    const session = records.filter((r) => r.session_id === result.observation.session_id);
    const redacted = new Set(session.filter((r) => r.op === 'image.redact').map((r) => r.ref));
    test.info().annotations.push({ type: 'measurement', description: `images.html: 7 images, 4 sent, ${redacted.size} processed` });
    // The budget stops processing early: fewer than all 7 were processed.
    expect(redacted.size).toBeLessThan(7);

    // M12 (M10 Noticed 2): a second load, now partly answered from the
    // cache, sends the same images. Node ids are assigned in DOM order, so
    // they match across loads of the same page.
    const again = await context.newPage();
    const second = await observe(again, `${server.url}pages/images.html?reload=1`);
    await again.close();
    if (second.status !== 'ok') throw new Error('blocked');
    const secondSent = new Set((second.observation.images as unknown as ObservedImage[]).map((i) => i.node_id));
    expect([...secondSent].sort()).toEqual([...sentNodes].sort());
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
  // M9: served under a public-looking name (host-resolver rule in
  // fixtures.ts) -- the fetch fallback refuses 127.0.0.1 itself, which the
  // `xp` image checks.
  const crossOrigin = await startStaticServer(FIXTURES_ROOT);
  const publicXo = crossOrigin.url.replace('127.0.0.1', E2E_PUBLIC_HOST);
  try {
    const page = await context.newPage();
    const result = await observe(
      page,
      `${server.url}pages/images-unreadable.html?xo=${encodeURIComponent(publicXo)}&xp=${encodeURIComponent(crossOrigin.url)}`,
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('blocked');

    const byName = new Map(
      result.observation.dom.filter((n) => n.image !== undefined).map((n) => [n.content.accessible_name ?? '', n.image_omitted]),
    );
    expect(Object.fromEntries(byName)).toEqual({
      'missing image': 'unreadable', // 404: no pixels via canvas or fetch (§6.2.3)
      'not an image': 'unreadable', // fetched fine, but doesn't decode (§6.2.3)
      // Acquired through the host fetch fallback, processed and sent.
      'cross-origin image': undefined,
      // M9: the fetch fallback refuses a private host (privateHost.ts).
      'private-host image': 'unreadable',
      'tiny image': 'too_small', // §6.1 size floor
      'no source': 'unreadable',
    });
    const xoSent = result.observation.dom.find((n) => n.content.accessible_name === 'cross-origin image');
    expect(result.observation.images.map((i) => i.node_id)).toEqual([xoSent?.node_id]);
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

    // The private-host image: canvas tainted, fetch refused before any
    // request was made, logged with its own reason.
    const xpNode = result.observation.dom.find((n) => n.content.accessible_name === 'private-host image');
    const xpAcquires = records.filter((r) => r.op === 'image.acquire' && r.ref === xpNode?.node_id && r.session_id === result.observation.session_id);
    expect(xpAcquires.map((r) => [r.outcome, r.reason ?? null])).toEqual([
      ['fail', 'cors_blocked'],
      ['fail', 'private_host'],
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
// M12: SCRFD is now the automatic face model everywhere, so BlazeFace (the
// only MediaPipe task) is pinned with the model override on its own profile.
test('model workers cannot phone home: MediaPipe’s metrics upload is refused and logged', async () => {
  test.setTimeout(180_000);
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'edward-egress-'));
  const context = await launchWithFaceProvider(userDataDir, 'face/blazeface-mediapipe');
  const extensionId = (context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))).url().split('/')[2] ?? '';
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
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
