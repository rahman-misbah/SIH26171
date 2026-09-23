// §18 item 1: the canary leak test. Fixture pages carry synthetic PII values
// ("canaries"); this test loads the extension, runs one real observation per
// fixture page (§5 DOM extraction -> §7 sanitize -> §14 assemble, triggered
// by the __EDWARD_E2E__ hook in src/entrypoints/content.ts), captures it with
// the mock backend registered via getBackend() (§12.4), and checks for
// canaries.
//
// M7 wires in the real NER provider (§7.2, gravitee-io/bert-small-pii-detection),
// so profile.html's NAME/ADDRESS/DOB canaries (NER-only, not regex-detectable)
// are exercised as a real assertion below instead of M5's scoped test.fail
// (see docs/MILESTONES.md M5 Log for the original ambiguity/decision writeup,
// and the M7 Log for the recall numbers this fixture produced).

import path from 'node:path';
import { getBackend } from '../../src/backend';
import type { AssembleResult } from '../../src/agent/assemble';
import { loadCanaries } from '../fixtures/loadCanaries';
import { expect, test } from './fixtures';
import { startStaticServer } from './staticServer';

const FIXTURES_ROOT = path.resolve(import.meta.dirname, '../fixtures');

// Every canary in each of these pages is regex/URL-catchable by M5's own
// pipeline (email/UPI/phone/Aadhaar/PAN/card/IFSC, a sensitive query key, or
// a secret/iframe-excluded field) -- see tests/fixtures/canaries.json.
const REGEX_CATCHABLE_PAGES = ['form', 'comments', 'contact', 'query-links', 'secret-form', 'iframe'] as const;

// contact.html's `email-public-support` canary is *designed* to survive
// (canaries.json's own note: "public per §7.5 heuristic, so it should stay
// visible once M7 lands") -- §7.5's public-contact-email heuristic keeps it
// as literal text rather than tokenizing it. Every other canary on every
// other page must still be fully redacted.
const EXPECTED_SURVIVORS: Partial<Record<(typeof REGEX_CATCHABLE_PAGES)[number], string[]>> = {
  contact: ['email-public-support'],
};

async function observe(page: import('@playwright/test').Page, url: string, timeout = 10_000): Promise<AssembleResult> {
  await page.goto(url);
  const handle = await page.waitForFunction(() => document.documentElement.dataset.edwardObservation, undefined, {
    timeout,
  });
  const raw = await handle.jsonValue();
  return JSON.parse(raw as string) as AssembleResult;
}

function findLeaks(observation: unknown, canaries: { id: string; value: string }[]): string[] {
  const json = JSON.stringify(observation);
  return canaries.filter((canary) => json.includes(canary.value)).map((canary) => canary.id);
}

test('the real text pipeline leaks no canaries on regex/URL-catchable fixtures', async ({ context }) => {
  const canaries = loadCanaries();
  const server = await startStaticServer(FIXTURES_ROOT);
  const backend = getBackend('mock');
  const leaksByPage: Record<string, string[]> = {};

  try {
    const page = await context.newPage();
    for (const name of REGEX_CATCHABLE_PAGES) {
      const result = await observe(page, `${server.url}pages/${name}.html`);
      expect(result.status, `${name}.html: observation should not be blocked by the final guard`).toBe('ok');
      if (result.status !== 'ok') continue;
      await backend.decide(result.observation);
      leaksByPage[name] = findLeaks(result.observation, canaries);
    }
    await page.close();
  } finally {
    await server.close();
  }

  test.info().annotations.push({
    type: 'measurement',
    description: `canary leaks by page (fixture id list): ${JSON.stringify(leaksByPage)}`,
  });

  for (const name of REGEX_CATCHABLE_PAGES) {
    const expected = EXPECTED_SURVIVORS[name] ?? [];
    expect(leaksByPage[name], `${name}.html should leak only its expected survivors (if any)`).toEqual(expected);
  }
});

test('profile.html leaks no canaries with the real NER provider (§7.2, M7)', async ({ context }) => {
  test.setTimeout(60_000); // real model load + inference, not just DOM/regex work
  const canaries = loadCanaries();
  const server = await startStaticServer(FIXTURES_ROOT);

  try {
    const page = await context.newPage();
    // The NER model loads (and runs) for real here -- give it more headroom
    // than the regex-only fixtures' default timeout.
    const result = await observe(page, `${server.url}pages/profile.html`, 30_000);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('blocked');
    const leaks = findLeaks(result.observation, canaries);
    test.info().annotations.push({ type: 'measurement', description: `profile.html leaks: ${JSON.stringify(leaks)}` });
    expect(leaks).toEqual([]);
    await page.close();
  } finally {
    await server.close();
  }
});

test('iframe content is excluded with an iframe_skipped marker, not read', async ({ context }) => {
  const server = await startStaticServer(FIXTURES_ROOT);
  try {
    const page = await context.newPage();
    const result = await observe(page, `${server.url}pages/iframe.html`);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('blocked');
    expect(result.observation.dom.some((n) => n.marker === 'iframe_skipped')).toBe(true);
    await page.close();
  } finally {
    await server.close();
  }
});

test('secret-form.html fields are marked secret and their values never appear', async ({ context }) => {
  const canaries = loadCanaries();
  const server = await startStaticServer(FIXTURES_ROOT);
  try {
    const page = await context.newPage();
    const result = await observe(page, `${server.url}pages/secret-form.html`);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('blocked');
    const secretNodes = result.observation.dom.filter((n) => n.secret === true);
    expect(secretNodes.length).toBeGreaterThan(0);
    expect(secretNodes.every((n) => n.content.value === '[SECRET]')).toBe(true);
    expect(findLeaks(result.observation, canaries)).toEqual([]);
    await page.close();
  } finally {
    await server.close();
  }
});

test('canvas.html carries a canvas_skipped marker (pixel-level canaries exercised in M8/M9)', async ({ context }) => {
  const server = await startStaticServer(FIXTURES_ROOT);
  try {
    const page = await context.newPage();
    const result = await observe(page, `${server.url}pages/canvas.html`);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('blocked');
    expect(result.observation.dom.some((n) => n.marker === 'canvas_skipped')).toBe(true);
    await page.close();
  } finally {
    await server.close();
  }
});

test('image fixtures still load (pixel-level canaries exercised in M8/M9)', async ({ context }) => {
  const server = await startStaticServer(FIXTURES_ROOT);
  try {
    const page = await context.newPage();
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
