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

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getBackend } from '../../src/backend';
import type { AssembleResult } from '../../src/agent/assemble';
import { loadCanaries } from '../fixtures/loadCanaries';
import { expect, test } from './fixtures';
import { decodeCodes, imageBytes, normalizeOcr, ocrText, type ObservedImage } from './imageForensics';
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

// M9 done-when: "Canary test passes for image fixtures (including OCR of
// outgoing images)" and "Non-PII text in images stays visible". §18.1: the
// observation JSON is checked, then every outgoing image is re-OCR'd and
// re-decoded in Node, and no canary may be readable in any of them.
test('image fixtures: no canary in the observation or in any outgoing image; non-PII image text stays readable', async ({ context }) => {
  test.setTimeout(120_000); // cold-loads face + OCR + QR + NER, then OCRs the outputs in Node
  const canaries = loadCanaries();
  const server = await startStaticServer(FIXTURES_ROOT);
  const IMAGE_CANARIES = ['email-personal', 'phone', 'pan'];

  try {
    const page = await context.newPage();
    const result = await observe(page, `${server.url}pages/images-text.html`, 60_000);
    await page.close();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('blocked');

    // All three images were processed, passed every detector and were sent.
    const imageNodes = result.observation.dom.filter((n) => n.image !== undefined);
    expect(imageNodes.map((n) => n.image_omitted)).toEqual([undefined, undefined, undefined]);
    const images = result.observation.images as unknown as ObservedImage[];
    expect(images).toHaveLength(3);
    expect(images.every((i) => i.mime === 'image/jpeg')).toBe(true);

    // Observation JSON (image bytes are base64 there, so this also checks
    // no canary sits in the encoded data as plain text).
    expect(findLeaks(result.observation, canaries)).toEqual([]);

    // Positive control: the same forensics DO find the canaries in the
    // original (unredacted) fixtures, so a clean result below means
    // "redacted", not "the checker can't read anything".
    const originals = ['rendered-text.png', 'ocr-mixed.png', 'qr-1.png'].map((f) => readFileSync(path.join(FIXTURES_ROOT, 'assets', f)));
    const originalText = (await ocrText(originals)).map(normalizeOcr);
    expect(originalText.some((t) => t.words.includes('abcpe1234f'))).toBe(true);
    expect(originalText.some((t) => t.digits.includes('9876543210'))).toBe(true);
    expect(await decodeCodes(originals)).toContain('priya.sharma.canary@example.com');

    // The outgoing images: nothing readable, nothing decodable.
    const outgoing = images.map(imageBytes);
    const outText = (await ocrText(outgoing)).map(normalizeOcr);
    const outCodes = await decodeCodes(outgoing);
    test.info().annotations.push({
      type: 'measurement',
      description: `outgoing image OCR: ${JSON.stringify(outText.map((t) => t.words))}; decoded codes: ${outCodes.length}`,
    });
    for (const id of IMAGE_CANARIES) {
      const canary = canaries.find((c) => c.id === id)!;
      const value = normalizeOcr(canary.value);
      for (const text of outText) {
        expect(text.words.includes(value.words), `${id} readable in an outgoing image`).toBe(false);
        if (value.digits.length >= 8) expect(text.digits.includes(value.digits), `${id} digits readable in an outgoing image`).toBe(false);
      }
    }
    expect(outText.some((t) => t.words.includes('canary@') || t.words.includes('sharma.canary'))).toBe(false);
    expect(outCodes).toEqual([]);

    // Non-PII text stays visible for the agent (M9 done-when).
    const allOut = outText.map((t) => t.words).join(' ');
    for (const word of ['order', 'summary', 'shipped', 'front', 'desk']) {
      expect(allOut, `non-PII word "${word}" should survive redaction`).toContain(word);
    }
  } finally {
    await server.close();
  }
});
