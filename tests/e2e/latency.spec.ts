// §15 "measure, then tune": baseline latency for dom.phase_a/dom.phase_b
// (content script) and sanitize.regex (host-side), recorded as a Playwright
// annotation for the M5 Log entry -- same pattern as M3's ping round-trip
// measurement. M7 adds sanitize.ner and model.load to the same summary
// (§9.6's done-when: "p50 sanitize.ner recorded, WebGPU vs WASM if
// available") -- profile.html (already in PAGES) is what triggers real NER.

import path from 'node:path';
import type { Page } from '@playwright/test';
import { aggregate } from '../../src/logging';
import type { LogRecord } from '../../src/logging/schema';
import { expect, test } from './fixtures';
import { startStaticServer } from './staticServer';

const FIXTURES_ROOT = path.resolve(import.meta.dirname, '../fixtures');
const PAGES = ['profile', 'form', 'comments', 'contact', 'query-links', 'secret-form', 'iframe'] as const;

function readLogRecords(page: Page): Promise<LogRecord[]> {
  return page.evaluate(
    () =>
      new Promise<LogRecord[]>((resolve, reject) => {
        const openReq = indexedDB.open('edward-logs', 1);
        openReq.onsuccess = () => {
          const tx = openReq.result.transaction('records', 'readonly');
          const getAllReq = tx.objectStore('records').getAll();
          getAllReq.onsuccess = () => resolve(getAllReq.result as LogRecord[]);
          getAllReq.onerror = () => reject(getAllReq.error ?? new Error('getAll failed'));
        };
        openReq.onerror = () => reject(openReq.error ?? new Error('indexedDB.open failed'));
      }),
  );
}

test('baseline latency for dom.phase_a / dom.phase_b / sanitize.regex', async ({ context, extensionId }) => {
  const server = await startStaticServer(FIXTURES_ROOT);
  try {
    const page = await context.newPage();
    for (const name of PAGES) {
      await page.goto(`${server.url}pages/${name}.html`);
      await page.waitForFunction(() => document.documentElement.dataset.edwardObservation, undefined, {
        timeout: 10_000,
      });
    }
    await page.close();

    // The logger flushes its ring buffer to IndexedDB every 5s (§11.2),
    // rather than on every write -- wait it out instead of forcing a flush
    // path that would only exist for this test.
    await new Promise((resolve) => setTimeout(resolve, 5_500));

    const offscreen = await context.newPage();
    await offscreen.goto(`chrome-extension://${extensionId}/offscreen.html`);
    const records = await readLogRecords(offscreen);
    await offscreen.close();

    const stats = aggregate(records);
    const summary = {
      'dom.phase_a': stats.perOp['dom.phase_a'],
      'dom.phase_b': stats.perOp['dom.phase_b'],
      'sanitize.regex': stats.perOp['sanitize.regex'],
      'sanitize.ner': stats.perOp['sanitize.ner'],
      'model.load': stats.perOp['model.load'],
    };
    const nerCompute = records.find((r) => r.op === 'sanitize.ner')?.compute;

    test.info().annotations.push({
      type: 'measurement',
      description: `baseline latency (p50/p95 ms, n) over ${PAGES.length} fixture pages: ${JSON.stringify(summary)}; sanitize.ner ran on compute=${nerCompute}`,
    });

    expect(stats.perOp['dom.phase_a']?.count).toBeGreaterThan(0);
    expect(stats.perOp['dom.phase_b']?.count).toBeGreaterThan(0);
    expect(stats.perOp['sanitize.regex']?.count).toBeGreaterThan(0);
    expect(stats.perOp['sanitize.ner']?.count).toBeGreaterThan(0);
  } finally {
    await server.close();
  }
});

// M9 done-when: "p50/p95 per image op recorded". Every image fixture page,
// each observed twice (the second pass is answered from the image cache), so
// the summary has cold and warm numbers for acquisition, each detector,
// redaction and cache hits, plus each model's cold load.
const IMAGE_PAGES = ['faces', 'images-text', 'images'] as const;
const IMAGE_OPS = ['image.acquire', 'image.face', 'image.ocr', 'image.qr', 'image.redact', 'image.cache_hit', 'image.cache_miss', 'context.assemble'] as const;

test('image pipeline latency per op (p50/p95)', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const server = await startStaticServer(FIXTURES_ROOT);
  try {
    const page = await context.newPage();
    for (const pass of [1, 2]) {
      for (const name of IMAGE_PAGES) {
        await page.goto(`${server.url}pages/${name}.html?pass=${pass}`);
        await page.waitForFunction(() => document.documentElement.dataset.edwardObservation, undefined, { timeout: 60_000 });
      }
    }
    await page.close();
    await new Promise((resolve) => setTimeout(resolve, 5_500));

    const offscreen = await context.newPage();
    await offscreen.goto(`chrome-extension://${extensionId}/offscreen.html`);
    const records = await readLogRecords(offscreen);
    await offscreen.close();

    const stats = aggregate(records);
    const summary = Object.fromEntries(IMAGE_OPS.map((op) => [op, stats.perOp[op]]));
    const loads = records
      .filter((r) => r.op === 'model.load')
      .map((r) => ({ model: r.model_id, ms: Math.round(r.duration_ms), compute: r.compute, outcome: r.outcome }));
    test.info().annotations.push({
      type: 'measurement',
      description: `image latency (p50/p95 ms, n) over ${IMAGE_PAGES.length} pages x2: ${JSON.stringify(summary)}; model.load: ${JSON.stringify(loads)}`,
    });

    for (const op of ['image.face', 'image.ocr', 'image.qr', 'image.redact', 'image.cache_hit'] as const) {
      expect(stats.perOp[op]?.count, op).toBeGreaterThan(0);
    }
  } finally {
    await server.close();
  }
});
