// M12 real-site pass (SPEC §18.1 applied to real pages). Run it through
// `npm run realsites -- --label "<machine>"` (scripts/realSites.ts), which
// builds the e2e extension first. Each site gets one observation from the
// e2e hook with the mock backend -- nothing is sent to any reasoning
// backend. The observation is reduced to counts in this process
// (summarize.ts) and never written anywhere; per-site op timings come from
// the metrics log, attributed by time window.

import { writeFile } from 'node:fs/promises';
import { aggregate } from '../../src/logging';
import type { LogRecord } from '../../src/logging/schema';
import type { RealSitesRun, SiteRun } from '../../scripts/realSitesTable.ts';
import { expect, test } from '../e2e/fixtures';
import { readLogsFromServiceWorker, readSessionsFromServiceWorker, waitForWarmStart } from '../e2e/logs';
import { REAL_SITES } from './sites';
import { summarizeObservation } from './summarize';

const NAV_TIMEOUT_MS = 45_000;
const OBSERVE_TIMEOUT_MS = 120_000;
// Images the assembler didn't wait for can still be processing after the
// observation returns (§15 "only waits for images it will send"); a pause
// keeps their records inside this site's window instead of the next one.
const SETTLE_MS = 3_000;
// The logger flushes every 5 s (§11.2).
const FLUSH_WAIT_MS = 5_500;

function inWindow(records: LogRecord[], start: number, end: number): LogRecord[] {
  return records.filter((r) => r.t_start >= start && r.t_start <= end && r.op !== 'model.load' && r.op !== 'model.warmup');
}

test('real sites: one observation each, counts only', async ({ context }) => {
  test.setTimeout(30 * 60_000);
  const out = process.env.EDWARD_REALSITES_OUT;
  if (!out) throw new Error('run via `npm run realsites` (needs EDWARD_REALSITES_OUT)');

  await waitForWarmStart(context);
  const windows: { start: number; end: number }[] = [];
  const partial: Omit<SiteRun, 'perOp' | 'failClosed' | 'reasons'>[] = [];

  // EDWARD_REALSITES_ONLY=id,id narrows the run while debugging one site.
  const only = process.env.EDWARD_REALSITES_ONLY?.split(',');
  for (const site of REAL_SITES.filter((s) => !only || only.includes(s.id))) {
    const page = await context.newPage();
    const start = Date.now();
    let entry: Omit<SiteRun, 'perOp' | 'failClosed' | 'reasons'> = { ...site, outcome: 'nav_failed' };
    try {
      await page.goto(site.url, { timeout: NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
      try {
        const handle = await page.waitForFunction(() => document.documentElement.dataset.edwardObservation, undefined, {
          timeout: OBSERVE_TIMEOUT_MS,
        });
        const raw = (await handle.jsonValue()) as string;
        const ms = await page.evaluate(() => document.documentElement.dataset.edwardObservationMs);
        // Redirects (e.g. a consent or bot-check page) change the origin the
        // email heuristic compares against.
        const origin = new URL(page.url()).origin;
        entry = { ...site, ...summarizeObservation(raw, origin), observation_ms: ms === undefined ? undefined : Number(ms) };
        // Only the error's name (e.g. SyntaxError), never its message: a
        // message can quote page content -- india.gov.in's selector error
        // embedded an element id. Console only, never the report.
        if (entry.outcome === 'error') console.log(`${site.id}: hook error: ${String((JSON.parse(raw) as { name?: unknown }).name)}`);
      } catch {
        entry = { ...site, outcome: 'timeout' };
      }
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    } catch {
      // navigation failed: entry stays nav_failed
    }
    await page.close();
    windows.push({ start, end: Date.now() });
    partial.push(entry);
    console.log(`${site.id}: ${entry.outcome}${entry.observation_ms !== undefined ? ` in ${Math.round(entry.observation_ms)} ms` : ''}`);
  }

  await new Promise((resolve) => setTimeout(resolve, FLUSH_WAIT_MS));
  const records = await readLogsFromServiceWorker(context);
  const [session] = await readSessionsFromServiceWorker(context);
  expect(session, 'compute-host session record').toBeDefined();
  if (!session) return;

  const sites: SiteRun[] = partial.map((entry, i) => {
    const window = windows[i] ?? { start: 0, end: 0 };
    const own = inWindow(records, window.start, window.end);
    const reasons: Record<string, number> = {};
    for (const r of own) if (r.reason) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
    const agg = aggregate(own);
    return { ...entry, perOp: agg.perOp as SiteRun['perOp'], failClosed: agg.failClosedCount, reasons };
  });

  const run: RealSitesRun = { device: session.device, sites };
  await writeFile(out, JSON.stringify(run, null, 2));
  expect(sites.some((s) => s.outcome === 'ok'), 'at least one site observed').toBe(true);
});
