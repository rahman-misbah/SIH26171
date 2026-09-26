import { describe, expect, it } from 'vitest';
import { leakCandidates, renderRealSitesSection, type RealSitesRun } from '../../../scripts/realSitesTable.ts';

const run: RealSitesRun = {
  device: { browser: 'chromium', gpu: { available: false }, compute: 'wasm', hardwareConcurrency: 8, platform: 'Linux' },
  sites: [
    {
      id: 'wiki',
      category: 'article',
      url: 'https://en.wikipedia.org/wiki/X',
      outcome: 'ok',
      observation_ms: 1234.4,
      summary: {
        nodes: 900,
        content_fields: 400,
        tokens: { NAME: 3, EMAIL: 1 },
        markers: { svg_skipped: 2 },
        image_nodes: 10,
        images_sent: 4,
        images_omitted: { too_small: 5, request_limit: 1 },
        text_kb: 150,
        images_kb: 60,
        truncated: true,
        trimmed_nodes: 7,
        residual: { EMAIL_LIKELY_PUBLIC: 1, PHONE: 2 },
      },
      perOp: { 'sanitize.ner': { p50: 400, p95: 900.6, count: 12 } },
      failClosed: 1,
      reasons: { request_limit: 1 },
    },
    { id: 'shop', category: 'e-commerce', url: 'https://shop.example/', outcome: 'nav_failed', perOp: {}, failClosed: 0, reasons: {} },
  ],
};

describe('renderRealSitesSection', () => {
  const section = renderRealSitesSection('Dev laptop', '2026-09-25', run);

  it('writes one summary row per site, with sorted breakdowns', () => {
    expect(section).toContain('## Dev laptop — 2026-09-25');
    expect(section).toContain('| wiki | article | ok | 1234 | 900 | 400 | yes (7) | EMAIL 1, NAME 3 | svg_skipped 2 | 4 / 10 | request_limit 1, too_small 5 | 150 | 60 | 2 |');
    expect(section).toContain('| shop | e-commerce | nav_failed | – |');
  });

  it('writes per-op p50/p95 and the residual breakdown', () => {
    expect(section).toContain('| wiki | – | – | 400 / 901 | – | – | – | 1 | request_limit 1 | EMAIL_LIKELY_PUBLIC 1, PHONE 2 |');
  });

  it('lists the URLs', () => {
    expect(section).toContain('- wiki: https://en.wikipedia.org/wiki/X');
  });
});

describe('leakCandidates', () => {
  it('excludes emails the heuristic may have kept public', () => {
    expect(leakCandidates(run.sites[0]?.summary)).toBe(2);
    expect(leakCandidates(undefined)).toBe(0);
  });
});
