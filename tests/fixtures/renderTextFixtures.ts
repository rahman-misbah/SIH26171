// Regenerates the rendered-text OCR fixtures (M9, decided in the M9 plan):
// synthetic PII + plainly non-PII text, rendered from HTML with Playwright's
// bundled Chromium and screenshotted to PNG. Committed so the fixtures can be
// reproduced exactly; the PNGs are committed too. All values are synthetic
// canaries from canaries.json -- never real data (§18).
//
// Run: node tests/fixtures/renderTextFixtures.ts

import path from 'node:path';
import { chromium } from '@playwright/test';

const OUT = path.resolve(import.meta.dirname, 'assets');

interface TextFixture {
  file: string;
  width: number;
  height: number;
  lines: string[];
}

const FIXTURES: TextFixture[] = [
  {
    // M4's version cut the email off at the right edge ("...@example.c"), so
    // OCR of an outgoing image could never have found it -- a test that
    // passes trivially. Same text, wide enough to show all of it.
    file: 'rendered-text.png',
    width: 560,
    height: 120,
    lines: ['Call Priya: +91 98765 43210', 'priya.sharma.canary@example.com'],
  },
  {
    // Non-PII text that must stay readable for the agent (M9 done-when),
    // next to a PAN and a phone number that must not. No dates or names in
    // the non-PII lines: NER would (correctly) redact those.
    file: 'ocr-mixed.png',
    width: 520,
    height: 200,
    lines: ['Order summary', 'Status: shipped to the front desk', 'PAN: ABCPE1234F', 'Phone: +91 98765 43210'],
  },
];

function html(fixture: TextFixture): string {
  const body = fixture.lines.map((line) => `<div>${line}</div>`).join('');
  return `<!doctype html><html><body style="margin:0">
    <div id="card" style="width:${fixture.width}px;height:${fixture.height}px;box-sizing:border-box;padding:14px 16px;
      background:#fff;color:#000;font:28px/1.5 'DejaVu Sans',Arial,sans-serif">${body}</div></body></html>`;
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const fixture of FIXTURES) {
      await page.setContent(html(fixture));
      await page.locator('#card').screenshot({ path: path.join(OUT, fixture.file) });
      console.log(`wrote ${fixture.file} (${fixture.width}x${fixture.height})`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
