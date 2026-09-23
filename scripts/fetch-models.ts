// §4.3 item 4 / §17: downloads tier-1 model weights into public/models/ so the
// extension ships offline (no first-run download). Tier-1 identities are
// SPEC §9.5's table. Run: `npm run fetch-models`.
//
// This script owns its own manifest rather than reading src/models/ (there is
// no models.config.ts yet — that's M7, SPEC §9.4) and is a plain Node script,
// not a Vite/WXT module — Node 24 runs .ts files directly (type-stripping,
// verified during M4 planning), so no ts-node/tsx devDependency was added.
//
// Runtime .wasm files that ship inside npm packages (zxing-wasm's reader, and
// since M9 the Tesseract.js core -- previously downloaded here pinned to
// 6.1.2, now copied from the installed tesseract.js-core so it always
// matches its loader) are copied by scripts/copy-runtime-assets.ts instead.

import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

interface ModelAsset {
  url: string;
  out: string; // path relative to public/models/
  approxBytes: number; // sanity check only, not a strict integrity hash
}

const MODELS_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../public/models');

const ASSETS: ModelAsset[] = [
  {
    // Face, tier 1 (§9.5): BlazeFace short-range via MediaPipe Tasks Vision.
    url: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
    out: 'face/blaze_face_short_range.tflite',
    approxBytes: 230_000,
  },
  {
    // OCR, tier 1 (§9.5): English language data (SPEC: "eng (+hin if time)").
    url: 'https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz',
    out: 'ocr/eng.traineddata.gz',
    approxBytes: 10_500_000,
  },
  {
    // NER, tier 1 (§9.5): gravitee-io/bert-small-pii-detection, quantized ONNX.
    // Transformers.js expects a specific local layout -- `onnx/<name>_<dtype-suffix>.onnx`,
    // e.g. `onnx/model_quantized.onnx` for `dtype: 'q8'` -- not the upstream
    // repo's flat `model.quant.onnx` filename (verified empirically while
    // building the M7 NER provider: from_pretrained() 404s against the flat
    // layout). SPEC §9.5 anticipated exactly this ("if its file layout
    // doesn't load directly, re-export to the Transformers.js layout").
    url: 'https://huggingface.co/gravitee-io/bert-small-pii-detection/resolve/main/model.quant.onnx',
    out: 'ner/onnx/model_quantized.onnx',
    approxBytes: 28_700_000,
  },
  {
    url: 'https://huggingface.co/gravitee-io/bert-small-pii-detection/resolve/main/config.json',
    out: 'ner/config.json',
    approxBytes: 3_000,
  },
  {
    url: 'https://huggingface.co/gravitee-io/bert-small-pii-detection/resolve/main/tokenizer.json',
    out: 'ner/tokenizer.json',
    approxBytes: 711_000,
  },
  {
    url: 'https://huggingface.co/gravitee-io/bert-small-pii-detection/resolve/main/tokenizer_config.json',
    out: 'ner/tokenizer_config.json',
    approxBytes: 1_400,
  },
  {
    url: 'https://huggingface.co/gravitee-io/bert-small-pii-detection/resolve/main/special_tokens_map.json',
    out: 'ner/special_tokens_map.json',
    approxBytes: 700,
  },
];

async function alreadyDownloaded(destination: string, approxBytes: number): Promise<boolean> {
  if (!existsSync(destination)) return false;
  const { size } = await stat(destination);
  // Loose sanity check (half the expected size) rather than an exact match —
  // these are upstream files we don't control the exact byte count of.
  return size > approxBytes / 2;
}

async function downloadAsset(asset: ModelAsset): Promise<void> {
  const destination = path.join(MODELS_ROOT, asset.out);
  if (await alreadyDownloaded(destination, asset.approxBytes)) {
    console.log(`skip (already present): ${asset.out}`);
    return;
  }

  await mkdir(path.dirname(destination), { recursive: true });
  console.log(`fetching ${asset.url}`);
  const response = await fetch(asset.url);
  if (!response.ok || !response.body) {
    throw new Error(`failed to download ${asset.url}: HTTP ${response.status}`);
  }

  // response.body is a DOM-lib ReadableStream (this tsconfig includes "DOM" for
  // the extension code); Readable.fromWeb wants node:stream/web's ReadableStream,
  // a structurally-identical but nominally different type — hence the cast.
  const webStream = response.body as unknown as Parameters<typeof Readable.fromWeb>[0];
  await pipeline(Readable.fromWeb(webStream), createWriteStream(destination));
  console.log(`wrote ${asset.out}`);
}

async function main(): Promise<void> {
  for (const asset of ASSETS) {
    await downloadAsset(asset);
  }
}

await main();
