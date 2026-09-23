// §18.1: "Also OCR the outgoing images and check for canaries." Runs in the
// Playwright (Node) process on the exact bytes the observation carried:
// Tesseract.js (same eng data the extension bundles, read from
// public/models/ocr -- never the CDN) and zxing-wasm (its .wasm read from
// node_modules). Test-only: nothing here is part of the extension.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createWorker, OEM, PSM } from 'tesseract.js';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';

const ROOT = path.resolve(import.meta.dirname, '../..');

export interface ObservedImage {
  img_id: string;
  node_id: string;
  mime: string;
  data: { base64: string }; // as written by the __EDWARD_E2E__ hook
}

export function imageBytes(image: ObservedImage): Buffer {
  return Buffer.from(image.data.base64, 'base64');
}

// Sparse-text page segmentation reads every scrap of text it can find,
// which is what a leak check wants (more text found = stricter check).
export async function ocrText(images: Buffer[]): Promise<string[]> {
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    langPath: path.join(ROOT, 'public/models/ocr'),
    gzip: true,
    cacheMethod: 'none',
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const texts: string[] = [];
    for (const image of images) texts.push((await worker.recognize(image)).data.text);
    return texts;
  } finally {
    await worker.terminate();
  }
}

let zxingReady: Promise<unknown> | undefined;

// Every decodable code's text, across all images.
export async function decodeCodes(images: Buffer[]): Promise<string[]> {
  zxingReady ??= prepareZXingModule({
    overrides: { wasmBinary: readFileSync(path.join(ROOT, 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm')).buffer },
    fireImmediately: true,
  });
  await zxingReady;
  const texts: string[] = [];
  for (const image of images) {
    const results = await readBarcodes(new Uint8Array(image), { tryHarder: true, maxNumberOfSymbols: 255 });
    for (const r of results) if (r.isValid) texts.push(r.text);
  }
  return texts;
}

// OCR output normalized for substring checks: case-folded, whitespace
// collapsed, and a digits-only view, so "+91 98765 43210" is still caught if
// OCR spaces the digits differently.
export function normalizeOcr(text: string): { words: string; digits: string } {
  return { words: text.toLowerCase().replace(/\s+/g, ' '), digits: text.replace(/\D/g, '') };
}
