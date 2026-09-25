import { describe, expect, it } from 'vitest';
import { renderBenchmarkSection, upsertSection, type BenchRun } from '../../../scripts/benchmarkTable.ts';

const device = (compute: 'wasm' | 'webgpu', forced = true): BenchRun['device'] => ({
  browser: 'chromium',
  gpu: { available: true, vendor: 'intel', architecture: 'gen-9' },
  compute,
  ...(forced ? { compute_forced: true as const } : {}),
  hardwareConcurrency: 8,
  deviceMemoryGB: 8,
  platform: 'Linux',
});

const wasm: BenchRun = {
  requested: 'wasm',
  device: device('wasm'),
  perOp: {
    'sanitize.ner': { p50: 480.4, p95: 720, count: 9 },
    'image.ocr': { p50: 960, p95: 1480, count: 7, queue: { p50: 1, p95: 3 } },
  },
  models: [
    { model_id: 'ner/x', compute: 'wasm', load_ms: 3900, outcome: 'ok' },
    { model_id: 'ocr/y', compute: 'wasm', load_ms: 3700, outcome: 'ok' },
  ],
};
const webgpu: BenchRun = {
  requested: 'webgpu',
  device: device('webgpu'),
  perOp: { 'sanitize.ner': { p50: 120, p95: 200, count: 9 } },
  models: [
    { model_id: 'ner/x', compute: 'webgpu', load_ms: 5000, outcome: 'ok' },
    { model_id: 'ocr/y', compute: 'wasm', load_ms: 3600, outcome: 'ok' },
  ],
};

describe('renderBenchmarkSection (§15: WebGPU vs WASM side by side)', () => {
  const md = renderBenchmarkSection('i5 laptop', '2026-09-24', [wasm, webgpu]);

  it('heads the section with the operator label and date', () => {
    expect(md.split('\n')[0]).toBe('## i5 laptop — 2026-09-24');
  });

  it('shows the structural device profile and the WebGPU adapter', () => {
    expect(md).toContain('8 logical cores');
    expect(md).toContain('intel / gen-9');
  });

  it('puts each op on one row with rounded WASM and WebGPU columns', () => {
    expect(md).toContain('| `sanitize.ner` | 480 | 720 | 9 | 120 | 200 | 9 |');
  });

  it('shows queue wait under the op when it was logged', () => {
    expect(md).toContain('| `image.ocr` | 960 | 1480 | 7 | – | – | – |');
    expect(md).toContain('| ↳ `image.ocr` queue wait | 1 | 3 |  | – | – |  |');
  });

  it('lists each model load with the compute it actually ran on', () => {
    expect(md).toContain('| `ocr/y` | 3700 (wasm) | 3600 (wasm) |');
    expect(md).toContain('| `ner/x` | 3900 (wasm) | 5000 (webgpu) |');
  });

  it('marks a WebGPU run that fell back to wasm as unavailable instead of reporting it as WebGPU', () => {
    const fellBack: BenchRun = { ...webgpu, device: device('wasm', false) };
    const out = renderBenchmarkSection('no-gpu box', '2026-09-24', [wasm, fellBack]);
    expect(out).toContain('WebGPU: unavailable');
    expect(out).toContain('| `sanitize.ner` | 480 | 720 | 9 | – | – | – |');
  });
});

describe('upsertSection', () => {
  const header = '# Benchmarks\n\nIntro.\n';

  it('appends a new label', () => {
    const doc = upsertSection(header, 'a', '## a — 2026-09-24\n\nbody a\n');
    expect(doc).toBe('# Benchmarks\n\nIntro.\n\n## a — 2026-09-24\n\nbody a\n');
  });

  it('replaces an existing label and keeps the others', () => {
    let doc = upsertSection(header, 'a', '## a — 2026-09-23\n\nold\n');
    doc = upsertSection(doc, 'b', '## b — 2026-09-23\n\nbee\n');
    doc = upsertSection(doc, 'a', '## a — 2026-09-24\n\nnew\n');
    expect(doc).toContain('## a — 2026-09-24\n\nnew\n');
    expect(doc).not.toContain('old');
    expect(doc).toContain('## b — 2026-09-23\n\nbee\n');
  });
});
