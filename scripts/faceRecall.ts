// M11 face-recall driver:
//   npm run bench:faces -- --label "<machine>" [--compute wasm|webgpu]
// Builds the e2e extension once with compute forced (default wasm, where the
// automatic choice would be BlazeFace, so SCRFD runs only because the
// settings pick it), runs tests/bench/faceRecall.spec.ts, and writes the
// recall table to docs/BENCHMARKS.md under the machine label (§18.4).
// Recall doesn't depend on compute; the detect time does.
//
// Plain Node script (Node 24 strips the types itself), like benchmark.ts.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { upsertSection } from './benchmarkTable.ts';
import { renderFaceRecallSection, type FaceRecallRun } from './faceRecallTable.ts';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const DOC = path.join(ROOT, 'docs/BENCHMARKS.md');

const { values } = parseArgs({ options: { label: { type: 'string' }, compute: { type: 'string', default: 'wasm' } } });
if (!values.label || (values.compute !== 'wasm' && values.compute !== 'webgpu')) {
  console.error('usage: npm run bench:faces -- --label "<machine>" [--compute wasm|webgpu]');
  process.exit(2);
}
const label = `${values.label} (${values.compute})`;

const out = path.join(ROOT, '.output/face-recall.json');
const env = { ...process.env, EDWARD_E2E: '1', EDWARD_FORCE_COMPUTE: values.compute, EDWARD_FACE_RECALL_OUT: out };
const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env }).status === 0;

if (!run('npx', ['wxt', 'build'])) process.exit(1);
if (!run('npx', ['playwright', 'test', '-c', 'playwright.bench.config.ts', 'tests/bench/faceRecall.spec.ts']) || !existsSync(out)) {
  console.error('face recall run failed; docs/BENCHMARKS.md unchanged');
  process.exit(1);
}

const runs = JSON.parse(await readFile(out, 'utf8')) as FaceRecallRun[];
const section = renderFaceRecallSection(label, new Date().toISOString().slice(0, 10), runs);
const doc = await readFile(DOC, 'utf8');
await writeFile(DOC, upsertSection(doc, `Face recall, ${label}`, section));
console.log(`\n${section}\nwritten to docs/BENCHMARKS.md`);
