// §4.3.3: "No remote code -- all worker scripts and .wasm files are bundled
// and their paths configured explicitly (Transformers.js/ONNX Runtime and
// Tesseract.js default to CDN URLs -- override them)." Model libraries ship
// their own runtime files inside their npm packages; this script copies them
// into public/ (git-ignored) so the providers can point at extension-local
// URLs instead of a CDN. Renamed from copy-ort-assets.ts in M8, when
// MediaPipe became the second library needing this.
//
// Unlike scripts/fetch-models.ts, nothing is downloaded here: every source
// file is already in node_modules once `npm install` has run.
//
// - ONNX Runtime Web (M7, NER provider -> env.backends.onnx.wasm.wasmPaths):
//   the whole `ort-wasm-simd-threaded.*` family is copied (not just one
//   variant) because onnxruntime-web picks the right one at load time based
//   on feature detection (SharedArrayBuffer / cross-origin isolation, WebGPU
//   via the .jsep variant) -- MV3 extension pages don't reliably have
//   COOP/COEP headers, so which variant it picks isn't pinned down here.
// - MediaPipe Tasks Vision (M8, face provider -> FilesetResolver base path):
//   only the ES-module loader variant (`vision_wasm_module_internal.*`) is
//   used -- the classic loader relies on `importScripts`, which module
//   Workers don't have (§9.5's MediaPipe-in-Worker note). The SIMD-less
//   module variant doesn't exist upstream, and every browser this project
//   targets (§4.4) has wasm SIMD.
//
// Run via `npm run postinstall` after `npm install`; re-run manually
// (`node scripts/copy-runtime-assets.ts`) if either library is upgraded.

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');

interface AssetGroup {
  name: string;
  from: string; // relative to the repo root
  to: string; // relative to the repo root
  include: (file: string) => boolean;
}

const GROUPS: AssetGroup[] = [
  {
    name: 'onnxruntime-web',
    from: 'node_modules/onnxruntime-web/dist',
    to: 'public/ort',
    include: (f) => f.startsWith('ort-wasm-simd-threaded.'),
  },
  {
    name: '@mediapipe/tasks-vision',
    from: 'node_modules/@mediapipe/tasks-vision/wasm',
    to: 'public/mediapipe',
    include: (f) => f.startsWith('vision_wasm_module_internal.'),
  },
];

async function copyGroup(group: AssetGroup): Promise<void> {
  const from = path.join(ROOT, group.from);
  if (!existsSync(from)) {
    console.log(`${group.name} not installed yet -- skipping (will run again on next npm install).`);
    return;
  }
  const to = path.join(ROOT, group.to);
  await mkdir(to, { recursive: true });

  const files = (await readdir(from)).filter(group.include);
  for (const file of files) {
    await copyFile(path.join(from, file), path.join(to, file));
    console.log(`copied: ${group.to}/${file}`);
  }
}

async function main(): Promise<void> {
  for (const group of GROUPS) await copyGroup(group);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
