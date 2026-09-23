// §9.5/§9.6: one vision worker -- loads MediaPipe Tasks Vision's BlazeFace
// short-range FaceDetector once, then answers one 'detect' message at a time
// (the pool in blazefaceMediapipe.ts never sends a worker overlapping jobs).
// A standard Worker, not an extension API, so this file isn't subject to the
// src/platform/ boundary (§4.2) even though it only runs in the compute host.
//
// §9.5 note "MediaPipe's WASM loader has had problems inside module Web
// Workers": the classic loader calls `importScripts`, which module workers
// don't have. MediaPipe's own fallback (verified in its bundle source, v1.0.1)
// catches that TypeError and dynamic-`import()`s the loader instead -- which
// only works with the ES-module loader variant, so FilesetResolver is asked
// for it explicitly (`useModule = true`). §4.3.3: both the loader and the
// .wasm come from the extension (public/mediapipe/, copied by
// scripts/copy-runtime-assets.ts), never MediaPipe's CDN default.

// Must stay the first import: installs the network egress guard before
// MediaPipe's module code runs (MediaPipe ships a usage-metrics uploader --
// see ../egressGuard.ts).
import '../workerEgressGuard';
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import { bucketFaceScore, MIN_DETECTION_CONFIDENCE } from './buckets';

interface InitMessage {
  type: 'init';
  wasmBaseUrl: string; // e.g. "chrome-extension://<id>/mediapipe" (no trailing slash)
  modelUrl: string; // e.g. "chrome-extension://<id>/models/face/blaze_face_short_range.tflite"
  compute: 'webgpu' | 'wasm';
}
interface DetectMessage {
  type: 'detect';
  id: number;
  image: ImageBitmap | ImageData;
}
type InMessage = InitMessage | DetectMessage;

type Face = { box: { x: number; y: number; w: number; h: number }; confidence: 'low' | 'medium' | 'high' };

type OutMessage =
  | { type: 'ready' }
  | { type: 'init-error'; message: string }
  | { type: 'detect-result'; id: number; result: Face[] }
  | { type: 'detect-error'; id: number; message: string };

function post(msg: OutMessage): void {
  // tsconfig's `lib` is DOM-only, so `self` types as Window -- same typing
  // workaround as the NER worker; at runtime this is a DedicatedWorkerGlobalScope.
  (self as unknown as Worker).postMessage(msg);
}

let detectorPromise: Promise<FaceDetector> | undefined;

function loadDetector(init: InitMessage): Promise<FaceDetector> {
  detectorPromise ??= (async () => {
    const fileset = await FilesetResolver.forVisionTasks(init.wasmBaseUrl, true);
    return FaceDetector.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: init.modelUrl,
        // §9.3: map the global compute decision (§10) onto MediaPipe's
        // delegate -- its "GPU" delegate is WebGL, used only when the
        // hardware profile says a GPU is available.
        delegate: init.compute === 'webgpu' ? 'GPU' : 'CPU',
      },
      runningMode: 'IMAGE',
      minDetectionConfidence: MIN_DETECTION_CONFIDENCE,
    });
  })();
  return detectorPromise;
}

self.onmessage = async (event: MessageEvent<InMessage>) => {
  const msg = event.data;

  if (msg.type === 'init') {
    try {
      await loadDetector(msg);
      post({ type: 'ready' });
    } catch (error) {
      post({ type: 'init-error', message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  try {
    if (!detectorPromise) throw new Error('worker received detect before init');
    const detector = await detectorPromise;
    const result = detector.detect(msg.image);
    const faces: Face[] = [];
    for (const detection of result.detections) {
      const bb = detection.boundingBox;
      if (!bb) continue;
      faces.push({
        box: { x: bb.originX, y: bb.originY, w: bb.width, h: bb.height },
        confidence: bucketFaceScore(detection.categories[0]?.score ?? 0),
      });
    }
    post({ type: 'detect-result', id: msg.id, result: faces });
  } catch (error) {
    post({ type: 'detect-error', id: msg.id, message: error instanceof Error ? error.message : String(error) });
  } finally {
    // The worker received its own structured-clone copy of the bitmap;
    // release it now rather than waiting for GC (§2.8: raw pixels live only
    // as long as processing needs them).
    if (msg.image instanceof ImageBitmap) msg.image.close();
  }
};
