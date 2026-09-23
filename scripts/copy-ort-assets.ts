// §4.3.3: "No remote code -- all worker scripts and .wasm files are bundled
// and their paths configured explicitly (Transformers.js/ONNX Runtime and
// Tesseract.js default to CDN URLs -- override them)." Transformers.js's
// NER provider (src/models/providers/ner/worker.ts) sets
// `env.backends.onnx.wasm.wasmPaths` to a local prefix instead of the
// library's jsDelivr default -- this script is what puts real files at that
// prefix.
//
// Unlike scripts/fetch-models.ts, nothing is downloaded here: onnxruntime-web
// (a transitive dependency of @huggingface/transformers, already present in
// node_modules once `npm install` has run) ships these .wasm/.mjs files in
// its own package. The whole `ort-wasm-simd-threaded.*` family is copied
// (not just one variant) because onnxruntime-web's own runtime picks the
// right one at load time based on feature detection (SharedArrayBuffer /
// cross-origin isolation, WebGPU via the .jsep variant) -- MV3 extension
// pages don't reliably have COOP/COEP headers, so which variant it actually
// picks isn't pinned down here; all of them are made available and it
// self-selects, the same as it would from its default CDN.
//
// Run via `npm run postinstall` (this script) after `npm install`; re-run
// manually (`node scripts/copy-ort-assets.ts`) if onnxruntime-web is upgraded.

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ORT_DIST = path.resolve(fileURLToPath(import.meta.url), '../../node_modules/onnxruntime-web/dist');
const OUT_DIR = path.resolve(fileURLToPath(import.meta.url), '../../public/ort');

async function main(): Promise<void> {
  if (!existsSync(ORT_DIST)) {
    console.log('onnxruntime-web not installed yet -- skipping (will run again on next npm install).');
    return;
  }
  await mkdir(OUT_DIR, { recursive: true });

  const files = (await readdir(ORT_DIST)).filter((f) => f.startsWith('ort-wasm-simd-threaded.'));
  for (const file of files) {
    await copyFile(path.join(ORT_DIST, file), path.join(OUT_DIR, file));
    console.log(`copied: ${file}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
