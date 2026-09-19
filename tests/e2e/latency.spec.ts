// §15 "measure, then tune": baseline latency for the M5 vertical slice's
// three ops (dom.phase_a in the content script, dom.phase_b likewise,
// sanitize.regex host-side), recorded as a Playwright annotation for the M5
// Log entry -- same pattern as M3's ping round-trip measurement.

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
    };

    test.info().annotations.push({
      type: 'measurement',
      description: `M5 baseline latency (p50/p95 ms, n) over ${PAGES.length} fixture pages: ${JSON.stringify(summary)}`,
    });

    expect(stats.perOp['dom.phase_a']?.count).toBeGreaterThan(0);
    expect(stats.perOp['dom.phase_b']?.count).toBeGreaterThan(0);
    expect(stats.perOp['sanitize.regex']?.count).toBeGreaterThan(0);
  } finally {
    await server.close();
  }
});
