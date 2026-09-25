// M11 Done-when: "Switching face tier needs only config; recall difference
// recorded" (§9.4, §18.4). Run through `npm run bench:faces -- --label
// "<machine>"` (scripts/faceRecall.ts). For each face provider it writes the
// model setting (the same storage key the settings page writes), restarts
// the browser on the same profile -- the documented way a model change takes
// effect -- and asks the active face detector for its boxes on
// face-recall.png (the __EDWARD_E2E__-only e2eFaceDetect request).
// (chrome.runtime.reload() would be quicker, but under Playwright it closes
// the whole browser.) Boxes are matched to the ground truth here; the full
// pipeline isn't used because its OCR redactions also cover faces, which
// would count as "found" for any detector. Output: counts, ratios, ms only.

import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import type { FaceRecallRun } from '../../scripts/faceRecallTable.ts';
import type { RecallFace } from '../fixtures/renderFaceRecall';
import { expect, launchExtensionContext, test } from '../e2e/fixtures';
import { readSessionsFromServiceWorker, waitForWarmStart } from '../e2e/logs';
import { startStaticServer } from '../e2e/staticServer';

const FIXTURES_ROOT = path.resolve(import.meta.dirname, '../fixtures');
const PROVIDERS = ['face/blazeface-mediapipe', 'face/scrfd-2.5g'] as const;
const FLUSH_WAIT_MS = 5_500; // the logger flushes every 5 s (§11.2)

// A detection matches a ground-truth face when its centre lies inside the
// face's box and they overlap by at least this IoU. The ground-truth box is
// the whole pasted portrait (hair, shoulders); a tight face box inside it
// has an IoU of roughly 0.3-0.5, so 0.2 accepts any plausible face box
// while rejecting a tiny or sprawling one.
const MATCH_IOU = 0.2;
// Timed detections per provider; the median is reported (warm, §15).
const TIMED_RUNS = 3;

async function serviceWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
}

// The one extension API used below, typed just enough for the callback (it
// runs inside the service worker; tests don't get the WXT types).
type ExtensionGlobal = { chrome: { storage: { local: { set(items: Record<string, unknown>): Promise<void> } } } };

// Writes the model setting, then restarts the browser on the same profile
// so the compute host starts with it.
async function launchWithFaceProvider(userDataDir: string, id: string): Promise<BrowserContext> {
  const setup = await launchExtensionContext(userDataDir);
  const sw = await serviceWorker(setup);
  await sw.evaluate(async (value) => {
    await (globalThis as unknown as ExtensionGlobal).chrome.storage.local.set({ 'edward.modelSettings': value });
  }, { overrides: { face: id } });
  await setup.close();
  return launchExtensionContext(userDataDir);
}

type Box = { x: number; y: number; w: number; h: number };

function iou(a: Box, b: Box): number {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = w * h;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

// Greedy one-to-one matching. Unmatched detections are false positives.
function match(faces: RecallFace[], detections: Box[]): { found: boolean[]; falsePositives: number } {
  const used = new Set<number>();
  const found = faces.map((f) => {
    const i = detections.findIndex((d, j) => {
      if (used.has(j)) return false;
      const cx = d.x + d.w / 2;
      const cy = d.y + d.h / 2;
      const inside = cx >= f.box.x && cx <= f.box.x + f.box.w && cy >= f.box.y && cy <= f.box.y + f.box.h;
      return inside && iou(d, f.box) >= MATCH_IOU;
    });
    if (i === -1) return false;
    used.add(i);
    return true;
  });
  return { found, falsePositives: detections.length - used.size };
}

type DetectResult = { faces: { box: Box }[]; duration_ms: number } | { error: string };

async function detectFaces(page: Page): Promise<{ faces: { box: Box }[]; duration_ms: number }> {
  await page.evaluate(() => {
    delete document.documentElement.dataset.edwardE2eFaceBoxes;
    document.documentElement.dataset.edwardE2eFaceDetect = '1';
  });
  const handle = await page.waitForFunction(() => document.documentElement.dataset.edwardE2eFaceBoxes, undefined, { timeout: 60_000 });
  const result = JSON.parse((await handle.jsonValue()) as string) as DetectResult;
  if ('error' in result) throw new Error(`face detection failed: ${result.error}`);
  return result;
}

test('face recall per provider (M11)', async () => {
  test.setTimeout(600_000);
  const out = process.env.EDWARD_FACE_RECALL_OUT;
  if (!out) throw new Error('run via `npm run bench:faces` (needs EDWARD_FACE_RECALL_OUT)');

  const faces = JSON.parse(readFileSync(path.join(FIXTURES_ROOT, 'assets/face-recall.json'), 'utf8')) as RecallFace[];
  const server = await startStaticServer(FIXTURES_ROOT);
  const runs: FaceRecallRun[] = [];
  try {
    for (const provider of PROVIDERS) {
      // A fresh profile per provider: no image-cache hits, no older sessions.
      const userDataDir = await mkdtemp(path.join(tmpdir(), 'edward-face-recall-'));
      const context = await launchWithFaceProvider(userDataDir, provider);
      try {
        await waitForWarmStart(context, 180_000);

        const page = await context.newPage();
        await page.goto(`${server.url}pages/face-recall.html`);
        // Readiness gate: the content script's own discovery observation.
        await page.waitForFunction(() => document.documentElement.dataset.edwardObservation, undefined, { timeout: 120_000 });

        const runsMs: number[] = [];
        let detections: Box[] = [];
        for (let i = 0; i < TIMED_RUNS; i++) {
          const result = await detectFaces(page);
          detections = result.faces.map((f) => f.box);
          runsMs.push(result.duration_ms);
        }
        await page.close();
        await new Promise((resolve) => setTimeout(resolve, FLUSH_WAIT_MS));

        // The restarted browser's compute-host session is the latest one.
        const sessions = await readSessionsFromServiceWorker(context);
        const session = [...sessions].sort((a, b) => b.started_at - a.started_at)[0];
        const faceModel = session?.models.find((m) => m.capability === 'face');
        const matched = match(faces, detections);

        runs.push({
          provider,
          loaded: faceModel?.model_id,
          compute: faceModel?.compute,
          found: faces.map((f, i) => ({ size: f.size, found: matched.found[i] ?? false })),
          falsePositives: matched.falsePositives,
          faceMs: runsMs.sort((a, b) => a - b)[Math.floor(runsMs.length / 2)],
        });
        // Only config changed: the override took effect.
        expect(faceModel?.model_id, 'loaded face model').toBe(provider);
      } finally {
        await context.close();
        await rm(userDataDir, { recursive: true, force: true });
      }
    }
  } finally {
    await server.close();
  }
  await writeFile(out, JSON.stringify(runs, null, 2));
});
