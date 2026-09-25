// §15 "measure, then tune": the benchmark behind docs/BENCHMARKS.md. Run it
// through `npm run bench -- --label "<machine>"` (scripts/benchmark.ts), which
// builds once per compute path (EDWARD_FORCE_COMPUTE) and runs this spec
// against each build. Replays every text and image fixture page after warm
// start and writes the run's per-op p50/p95 and model loads as JSON to
// EDWARD_BENCH_OUT. Metrics only: records hold no content (§11).

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { aggregate } from '../../src/logging';
import type { BenchRun } from '../../scripts/benchmarkTable.ts';
import { expect, test } from '../e2e/fixtures';
import { readLogsFromServiceWorker, readSessionsFromServiceWorker, waitForWarmStart } from '../e2e/logs';
import { startStaticServer } from '../e2e/staticServer';

const FIXTURES_ROOT = path.resolve(import.meta.dirname, '../fixtures');
const TEXT_PAGES = ['profile', 'form', 'comments', 'contact', 'query-links', 'secret-form', 'iframe'] as const;
const IMAGE_PAGES = ['faces', 'images-text', 'images'] as const;
// Image pages twice: the second pass is answered from the image cache, so
// image.cache_hit gets real numbers too.
const IMAGE_PASSES = 2;
// The logger flushes every 5 s (§11.2).
const FLUSH_WAIT_MS = 5_500;

test('benchmark: fixture replay, per-op p50/p95', async ({ context }) => {
  test.setTimeout(600_000);
  const requested = process.env.EDWARD_FORCE_COMPUTE;
  const out = process.env.EDWARD_BENCH_OUT;
  if ((requested !== 'wasm' && requested !== 'webgpu') || !out) {
    throw new Error('run via `npm run bench` (needs EDWARD_FORCE_COMPUTE and EDWARD_BENCH_OUT)');
  }

  const server = await startStaticServer(FIXTURES_ROOT);
  try {
    await waitForWarmStart(context);
    const page = await context.newPage();
    const observe = async (url: string) => {
      await page.goto(url);
      await page.waitForFunction(() => document.documentElement.dataset.edwardObservation, undefined, { timeout: 120_000 });
    };
    for (const name of TEXT_PAGES) await observe(`${server.url}pages/${name}.html`);
    for (let pass = 1; pass <= IMAGE_PASSES; pass++) {
      for (const name of IMAGE_PAGES) await observe(`${server.url}pages/${name}.html?pass=${pass}`);
    }
    await page.close();
    await new Promise((resolve) => setTimeout(resolve, FLUSH_WAIT_MS));

    const records = await readLogsFromServiceWorker(context);
    const [session] = await readSessionsFromServiceWorker(context);
    expect(session, 'compute-host session record').toBeDefined();
    if (!session) return;

    const run: BenchRun = {
      requested,
      device: session.device,
      perOp: aggregate(records).perOp as BenchRun['perOp'],
      models: records
        .filter((r) => r.op === 'model.load' && r.model_id !== undefined)
        .map((r) => ({ model_id: r.model_id ?? '', compute: r.compute ?? 'n/a', load_ms: r.duration_ms, outcome: r.outcome })),
    };
    await writeFile(out, JSON.stringify(run, null, 2));
    expect(run.perOp['sanitize.ner']?.count).toBeGreaterThan(0);
    expect(run.perOp['image.ocr']?.count).toBeGreaterThan(0);
  } finally {
    await server.close();
  }
});
