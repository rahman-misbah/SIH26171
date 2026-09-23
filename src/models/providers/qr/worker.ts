// §9.5/§9.6: one QR worker. zxing-wasm `readBarcodes`, restricted to QR +
// common 1D/2D formats (§9.5). Answers one 'detect' message at a time (the
// pool in zxing.ts never overlaps jobs on a worker).
//
// Privacy: zxing decodes each code's content, but **only boxes leave this
// worker**. The decoded text/bytes are dropped here and never posted,
// logged or stored -- §6.4.3 redacts every code regardless of content
// (content classification is out of scope, §16).

// Must stay the first import (SPEC §9.5, CLAUDE.md): installs the network
// egress guard before the library's module code runs.
import '../workerEgressGuard';
import { prepareZXingModule, readBarcodes, type ReaderOptions } from 'zxing-wasm/reader';
import { positionToBox } from './box';

interface InitMessage {
  type: 'init';
  wasmUrl: string; // e.g. "chrome-extension://<id>/zxing/zxing_reader.wasm"
}
interface DetectMessage {
  type: 'detect';
  id: number;
  image: ImageBitmap | ImageData;
}
type InMessage = InitMessage | DetectMessage;

type Code = { box: { x: number; y: number; w: number; h: number }; confidence: 'low' | 'medium' | 'high' };

type OutMessage =
  | { type: 'ready' }
  | { type: 'init-error'; message: string }
  | { type: 'detect-result'; id: number; result: Code[] }
  | { type: 'detect-error'; id: number; message: string };

function post(msg: OutMessage): void {
  // tsconfig's `lib` is DOM-only, so `self` types as Window -- same typing
  // workaround as the other workers.
  (self as unknown as Worker).postMessage(msg);
}

const READER_OPTIONS: ReaderOptions = {
  // §9.5: QR + the common 2D and 1D symbologies (retail, logistics, IDs).
  formats: ['QRCode', 'MicroQRCode', 'RMQRCode', 'DataMatrix', 'Aztec', 'PDF417', 'EAN13', 'EAN8', 'UPCA', 'UPCE', 'Code128', 'Code39', 'Code93', 'ITF', 'Codabar'],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  // Fail-closed: a code that was located but failed to decode (damaged,
  // partly occluded) is still returned, so its box is still redacted.
  returnErrors: true,
  maxNumberOfSymbols: 255,
};

let ready: Promise<unknown> | undefined;

function toImageData(image: ImageBitmap | ImageData): ImageData {
  if (image instanceof ImageData) return image;
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, image.width, image.height);
}

self.onmessage = async (event: MessageEvent<InMessage>) => {
  const msg = event.data;

  if (msg.type === 'init') {
    try {
      // §4.3.3: the .wasm comes from the extension (public/zxing/, copied by
      // scripts/copy-runtime-assets.ts), not zxing-wasm's jsDelivr default.
      ready ??= prepareZXingModule({
        overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? msg.wasmUrl : prefix + path) },
        fireImmediately: true,
      });
      await ready;
      post({ type: 'ready' });
    } catch (error) {
      post({ type: 'init-error', message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  try {
    if (!ready) throw new Error('worker received detect before init');
    await ready;
    const results = await readBarcodes(toImageData(msg.image), READER_OPTIONS);
    // zxing reports no score, so every returned code is 'high'; every code is
    // redacted regardless (§8.3).
    const codes: Code[] = results.map((r) => ({ box: positionToBox(r.position), confidence: 'high' }));
    post({ type: 'detect-result', id: msg.id, result: codes });
  } catch (error) {
    post({ type: 'detect-error', id: msg.id, message: error instanceof Error ? error.message : String(error) });
  } finally {
    // This worker's structured-clone copy of the pixels (§2.8).
    if (msg.image instanceof ImageBitmap) msg.image.close();
  }
};
