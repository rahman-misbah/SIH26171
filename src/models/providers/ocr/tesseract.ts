// §9.3, §9.5: Tesseract.js v6 (`eng`, LSTM engine) -- the tier-1 OCR
// provider. Word boxes come from `recognize(img, {}, { blocks: true })`.
// §9.6: K = clamp(hardwareConcurrency / 2, 1, 2) pre-initialized workers,
// one recognition at a time each, behind createWorkerPool (the same pool
// primitive as the face provider, instead of Tesseract's own scheduler, so
// every model pool has the same queueing and timeout behaviour).
//
// §4.3.3 no remote code / no CDN: the worker script, core and language data
// all come from the extension (public/tesseract/, public/models/ocr/), and
// the worker is our own guarded bootstrap (workerBootstrap.ts).
// `cacheMethod: 'none'`: Tesseract.js would otherwise copy the language data
// into IndexedDB -- it's already bundled, so that would only duplicate it.

import { createWorker, OEM } from 'tesseract.js';
import type { Worker as TesseractWorker } from 'tesseract.js';
import bootstrapUrl from './workerBootstrap.ts?worker&url';
import { createWorkerPool } from '@/core/pool';
import type { ImageInput, OcrEngine } from '@/models/capabilities';
import type { ModelProvider } from '@/models/provider';
import { logEgressBlocked } from '../egressGuard';
import { flattenBlocks, type FlatWord, type TessBlock } from './flatten';

// §9.6: OCR is the heaviest per-image stage (CPU/wasm only) and each worker
// holds its own ~15 MB engine, so at most 2 -- half the cores, at least 1.
export function ocrWorkerCount(hardwareConcurrency: number): number {
  return Math.min(2, Math.max(1, Math.floor(hardwareConcurrency / 2)));
}

// A recognition that hasn't answered in this long fails the stage, so the
// image is withheld (§6.4.6) instead of hanging the observation. Measured
// OCR on the fixtures is well under a second on wasm (see the M9 Log); 30s
// leaves headroom for a large, text-dense image on a slow, contended machine.
const READ_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('OCR timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

// Tesseract.js reads an OffscreenCanvas by encoding it to PNG in its own
// loader, then ships the bytes to its worker.
function toCanvas(img: ImageInput): OffscreenCanvas {
  const source = 'bitmap' in img ? img.bitmap : img.data;
  const canvas = new OffscreenCanvas(source.width, source.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  if ('bitmap' in img) ctx.drawImage(img.bitmap, 0, 0);
  else ctx.putImageData(img.data, 0, 0);
  return canvas;
}

// Tesseract.js exposes the underlying Web Worker at runtime (`worker.worker`)
// but not in its type definitions.
function underlyingWorker(worker: TesseractWorker): Worker | undefined {
  const raw = (worker as unknown as { worker?: unknown }).worker;
  return raw instanceof Worker ? raw : undefined;
}

export const tesseractOcr: ModelProvider<'ocr'> = {
  id: 'ocr/tesseract-eng-lstm',
  capability: 'ocr',
  tier: 1,
  requires: {}, // CPU/wasm everywhere
  approxDownloadMB: 14, // ~3 MB core wasm + ~11 MB eng traineddata (gz)

  async load(ctx): Promise<OcrEngine> {
    const onEgressBlocked = (): void =>
      logEgressBlocked(ctx.logger, { session_id: ctx.session_id, op: 'image.ocr', model_id: tesseractOcr.id });

    const start = async (): Promise<TesseractWorker> => {
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: bootstrapUrl,
        workerBlobURL: false,
        corePath: ctx.assetUrl('/tesseract/'),
        langPath: ctx.assetUrl('/models/ocr'),
        gzip: true,
        cacheMethod: 'none',
        // Without a handler Tesseract.js rethrows job failures from its
        // message listener (an uncaught error); the job's own promise still
        // rejects, which is all the pipeline needs.
        errorHandler: () => {},
      });
      // The guard reports a refused request as a bare message; Tesseract.js
      // ignores messages without a `status`, so both can listen.
      underlyingWorker(worker)?.addEventListener('message', (event: MessageEvent<unknown>) => {
        const data = event.data as { type?: unknown } | null;
        if (data?.type === 'egress-blocked') onEgressBlocked();
      });
      return worker;
    };

    // All K must start (same reasoning as the face pool): any failure fails
    // the load -> the registry's fail-closed fallback withholds every image.
    const workers = await Promise.all(Array.from({ length: ocrWorkerCount(navigator.hardwareConcurrency || 1) }, start));
    const pool = createWorkerPool(workers);

    return {
      read(img) {
        return pool.run(async (worker): Promise<FlatWord[]> => {
          const { data } = await withTimeout(
            worker.recognize(toCanvas(img), {}, { blocks: true, text: false, hocr: false, tsv: false }),
            READ_TIMEOUT_MS,
          );
          return flattenBlocks(data.blocks as TessBlock[] | null);
        });
      },
    };
  },

  // No session-end model teardown exists yet (same as the other providers).
  async dispose(): Promise<void> {},
};
