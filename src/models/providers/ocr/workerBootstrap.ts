// §9.5/§9.6: the script each Tesseract.js worker runs. Tesseract.js spawns
// its own Worker from `workerPath` (tesseract.ts points it here instead of
// its jsDelivr default, §4.3.3), and its worker code is a *classic* script
// that loads the core with `importScripts`. Vite bundles this file as a
// classic (IIFE) worker, so `importScripts` is available.
//
// Order matters:
// 1. The egress guard, first -- every model Worker installs it before any
//    library code runs (SPEC §9.5, CLAUDE.md).
// 2. The core (bundled in public/tesseract/ by copy-runtime-assets.ts).
//    Emscripten looks for its .wasm next to the *worker* script, not next to
//    the core loader, and Tesseract.js passes no `locateFile` -- so the core
//    factory is wrapped here to point at public/tesseract/. Tesseract.js's
//    own core loader (getCore) skips loading when `TesseractCore` already
//    exists, so it uses this wrapped one.
// 3. Tesseract.js's worker script, which registers the message handler.
//
// Only the SIMD + LSTM-only core is shipped: every browser in §4.4 has wasm
// SIMD (the same assumption as the MediaPipe assets), and the OCR provider
// uses the LSTM engine only.

import '../workerEgressGuard';

type CoreFactory = (options: Record<string, unknown>) => Promise<unknown>;
interface ClassicWorkerScope {
  importScripts(...urls: string[]): void;
  location: { origin: string };
  TesseractCore?: CoreFactory;
}

// tsconfig's `lib` is DOM-only, so `self` types as Window; at runtime this
// is a DedicatedWorkerGlobalScope.
const scope = self as unknown as ClassicWorkerScope;
const base = `${scope.location.origin}/tesseract/`;

scope.importScripts(`${base}tesseract-core-simd-lstm.wasm.js`);
const core = scope.TesseractCore;
if (!core) throw new Error('Tesseract core failed to load');
scope.TesseractCore = (options) => core({ ...options, locateFile: (file: string) => `${base}${file}` });

scope.importScripts(`${base}worker.min.js`);
