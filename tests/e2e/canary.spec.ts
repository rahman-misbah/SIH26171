// §18 item 1: the canary leak test. Fixture pages carry synthetic PII values
// ("canaries"); this test loads the extension (SPEC's own wording for this
// test — the extension isn't otherwise exercised yet, since M5's real
// DOM -> sanitize -> assembler pipeline doesn't exist), runs one "observation"
// per fixture page via the test-only naiveObserve() shim (see its header
// comment), captures it with the mock backend registered through the real
// getBackend() (§12.4), and checks for canaries.
//
// This is expected to fail right now: naiveObserve() applies zero redaction,
// so canaries leak straight through. That's the "expected reason" M4's
// done-when item asks for. Flip the first test below to a real assertion
// once M5 lands sanitization (docs/MILESTONES.md M4 Log).

import path from 'node:path';
import { getBackend } from '../../src/backend';
import { loadCanaries } from '../fixtures/loadCanaries';
import { expect, test } from './fixtures';
import { naiveObserve } from './naiveObserve';
import { startStaticServer } from './staticServer';

const FIXTURES_ROOT = path.resolve(import.meta.dirname, '../fixtures');

// canvas.html and images.html are excluded: their canaries live in pixels
// (canvas-drawn text, rendered-text/face/QR images), which naiveObserve()
// never reads — that requires OCR/face/QR detection, arriving in M8/M9.
const TEXT_PAGES = ['profile', 'form', 'comments', 'contact', 'query-links', 'secret-form', 'iframe'] as const;

function findLeaks(observation: unknown, canaries: { id: string; value: string }[]): string[] {
  const json = JSON.stringify(observation);
  return canaries.filter((canary) => json.includes(canary.value)).map((canary) => canary.id);
}

test('naive raw-DOM capture leaks canaries (expected until M5 builds real sanitization)', async ({ context }) => {
  test.fail(
    true,
    'No DOM/sanitize pipeline exists yet (M5) — the naive test-only shim applies zero redaction ' +
      'on purpose, so canaries are expected to leak. See tests/e2e/naiveObserve.ts and ' +
      'docs/MILESTONES.md M4 Log.',
  );

  const canaries = loadCanaries();
  const server = await startStaticServer(FIXTURES_ROOT);
  const backend = getBackend('mock');
  const leaksByPage: Record<string, string[]> = {};

  try {
    const page = await context.newPage();
    for (const name of TEXT_PAGES) {
      await page.goto(`${server.url}pages/${name}.html`);
      const obs = await naiveObserve(page, 'canary-session', 0);
      await backend.decide(obs);
      leaksByPage[name] = findLeaks(obs, canaries);
    }
    await page.close();
  } finally {
    await server.close();
  }

  test.info().annotations.push({
    type: 'measurement',
    description: `canary leaks by page (fixture id list): ${JSON.stringify(leaksByPage)}`,
  });

  for (const name of TEXT_PAGES) {
    expect(leaksByPage[name], `${name}.html should leak no canaries once sanitization exists`).toEqual([]);
  }
});

test('canvas and image fixtures load (pixel-level canaries exercised in M8/M9)', async ({ context }) => {
  const server = await startStaticServer(FIXTURES_ROOT);
  try {
    const page = await context.newPage();

    await page.goto(`${server.url}pages/canvas.html`);
    await expect(page.locator('#canaryCanvas')).toBeVisible();

    await page.goto(`${server.url}pages/images.html`);
    for (const id of ['rendered-text', 'face-1', 'face-2', 'qr-1']) {
      const img = page.locator(`img[data-canary="${id}"]`);
      await expect(img).toBeVisible();
      expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth), `${id} should decode as an image`).toBeGreaterThan(0);
    }

    await page.close();
  } finally {
    await server.close();
  }
});
