// §15 "report WebGPU vs WASM numbers side by side": turns one benchmark
// run per compute path (written by tests/bench/benchmark.spec.ts) into a
// markdown section of docs/BENCHMARKS.md. Pure -- no I/O -- so it's unit
// tested (tests/unit/scripts/benchmarkTable.test.ts).

import type { OpStats } from '../src/logging/aggregate.ts';
import type { DeviceProfile } from '../src/hw/types.ts';

export interface BenchRun {
  requested: 'wasm' | 'webgpu';
  device: DeviceProfile;
  perOp: Record<string, OpStats>;
  models: { model_id: string; compute: string; load_ms: number; outcome: string }[];
}

// Fixed row order: the pipeline's own order, so tables from different
// machines line up. Ops not listed here are appended alphabetically.
const OP_ORDER = [
  'dom.phase_a',
  'dom.phase_b',
  'sanitize.regex',
  'sanitize.ner',
  'image.acquire',
  'image.face',
  'image.ocr',
  'image.qr',
  'image.redact',
  'image.cache_hit',
  'image.cache_miss',
  'context.assemble',
  'model.load',
  'model.warmup',
];

const DASH = '–';

function ms(n: number): string {
  return String(Math.round(n));
}

// A requested WebGPU run that fell back to wasm (no adapter) must never be
// shown as WebGPU numbers.
function effective(run: BenchRun | undefined): BenchRun | undefined {
  if (!run) return undefined;
  if (run.requested === 'webgpu' && run.device.compute !== 'webgpu') return undefined;
  return run;
}

function cells(stats: OpStats | undefined): string[] {
  return stats ? [ms(stats.p50), ms(stats.p95), String(stats.count)] : [DASH, DASH, DASH];
}

function queueCells(stats: OpStats | undefined): string[] {
  return stats?.queue ? [ms(stats.queue.p50), ms(stats.queue.p95), ''] : [DASH, DASH, ''];
}

function describeDevice(device: DeviceProfile): string {
  const parts = [
    device.browser,
    device.platform ?? 'platform n/a',
    `${device.hardwareConcurrency} logical cores`,
    device.deviceMemoryGB !== undefined ? `≥${device.deviceMemoryGB} GB RAM` : 'RAM n/a',
  ];
  return parts.join(' · ');
}

function describeAdapter(run: BenchRun | undefined, requested: BenchRun | undefined): string {
  if (!requested) return 'WebGPU: not run';
  if (!run) return 'WebGPU: unavailable (no adapter; that run fell back to wasm and is not shown)';
  const { vendor, architecture } = run.device.gpu;
  return `WebGPU adapter: ${vendor ?? 'n/a'} / ${architecture ?? 'n/a'}`;
}

export function renderBenchmarkSection(label: string, date: string, runs: BenchRun[]): string {
  const wasm = runs.find((r) => r.requested === 'wasm');
  const webgpuRequested = runs.find((r) => r.requested === 'webgpu');
  const webgpu = effective(webgpuRequested);
  const device = (wasm ?? webgpuRequested)?.device;

  const ops = new Set([...Object.keys(wasm?.perOp ?? {}), ...Object.keys(webgpu?.perOp ?? {})]);
  const ordered = [
    ...OP_ORDER.filter((op) => ops.has(op)),
    ...[...ops].filter((op) => !OP_ORDER.includes(op)).sort(),
  ];

  const lines: string[] = [`## ${label} — ${date}`, ''];
  if (device) lines.push(`${describeDevice(device)}  `);
  lines.push(`${describeAdapter(webgpu, webgpuRequested)}`, '');
  lines.push('| op (ms) | WASM p50 | WASM p95 | n | WebGPU p50 | WebGPU p95 | n |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const op of ordered) {
    const a = wasm?.perOp[op];
    const b = webgpu?.perOp[op];
    lines.push(`| \`${op}\` | ${[...cells(a), ...cells(b)].join(' | ')} |`);
    if (a?.queue || b?.queue) {
      lines.push(`| ↳ \`${op}\` queue wait | ${[...queueCells(a), ...queueCells(b)].join(' | ')} |`);
    }
  }

  const modelIds = [...new Set([...(wasm?.models ?? []), ...(webgpu?.models ?? [])].map((m) => m.model_id))].sort();
  if (modelIds.length > 0) {
    lines.push('', '| model | load ms, WASM run (ran on) | load ms, WebGPU run (ran on) |', '|---|---:|---:|');
    const loadCell = (run: BenchRun | undefined, id: string): string => {
      const m = run?.models.find((x) => x.model_id === id);
      if (!m) return DASH;
      return m.outcome === 'ok' ? `${ms(m.load_ms)} (${m.compute})` : `failed (${m.outcome})`;
    };
    for (const id of modelIds) lines.push(`| \`${id}\` | ${loadCell(wasm, id)} | ${loadCell(webgpu, id)} |`);
  }
  return `${lines.join('\n')}\n`;
}

// Replaces the section whose heading starts with `## <label> — `, or appends
// one. Sections run until the next `## ` heading.
export function upsertSection(doc: string, label: string, section: string): string {
  const prefix = `## ${label} — `;
  const lines = doc.split('\n');
  const start = lines.findIndex((l) => l.startsWith(prefix));
  if (start === -1) {
    const trimmed = doc.endsWith('\n') ? doc : `${doc}\n`;
    return `${trimmed}\n${section}`;
  }
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end === -1) end = lines.length;
  const before = lines.slice(0, start).join('\n');
  const after = lines.slice(end).join('\n');
  return `${before}\n${section}${after ? `\n${after}` : ''}`;
}
