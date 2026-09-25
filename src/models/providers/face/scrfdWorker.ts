// §9.5 tier-2 face: one SCRFD-2.5G worker. Loads the ONNX model once with
// ONNX Runtime Web, then answers one 'detect' message at a time (the pool in
// scrfd.ts never sends a worker overlapping jobs). Speaks the same
// init/detect protocol as the BlazeFace and QR workers (../workerClient.ts).
//
// §4.3.3: the model and ORT's .wasm/.mjs runtime come from the extension
// (public/models/face/, public/ort/), never a CDN.

// Must stay the first import: installs the network egress guard before ONNX
// Runtime's module code runs (defence in depth, see ../egressGuard.ts).
import '../workerEgressGuard';
// The /webgpu entry has both the WebGPU and the wasm execution providers.
import * as ort from 'onnxruntime-web/webgpu';
import { bucketFaceScore } from './buckets';
import { decodeScrfd, letterboxFor, SCRFD_INPUT_SIZE, SCRFD_STRIDES, type ScrfdOutputs } from './scrfdDecode';

interface InitMessage {
  type: 'init';
  modelUrl: string;
  ortWasmBaseUrl: string; // e.g. "chrome-extension://<id>/ort/" (trailing slash)
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
  // workaround as the other model workers.
  (self as unknown as Worker).postMessage(msg);
}

let sessionPromise: Promise<ort.InferenceSession> | undefined;

function loadSession(init: InitMessage): Promise<ort.InferenceSession> {
  sessionPromise ??= (async () => {
    ort.env.wasm.wasmPaths = init.ortWasmBaseUrl;
    // §9.3: one execution provider, the one the compute decision names. No
    // silent wasm fallback on a WebGPU device: if WebGPU fails, the load
    // fails, and the registry drops to BlazeFace and logs it (§9.4), so the
    // logged compute is always the one that actually ran.
    return ort.InferenceSession.create(init.modelUrl, { executionProviders: [init.compute === 'webgpu' ? 'webgpu' : 'wasm'] });
  })();
  return sessionPromise;
}

// Letterbox the image into a 640x640 RGB tensor, normalised as in
// InsightFace's scrfd.py: (pixel - 127.5) / 128, CHW. Only drawImage +
// getImageData on the canvas -- never convertToBlob, which stalls for ~1 s
// in Chromium's offscreen document (CLAUDE.md browser quirks).
async function toInputTensor(image: ImageBitmap | ImageData): Promise<{ tensor: ort.Tensor; scale: number }> {
  const { scale, width, height } = letterboxFor(image.width, image.height);
  const bitmap = image instanceof ImageBitmap ? image : await createImageBitmap(image);
  const canvas = new OffscreenCanvas(SCRFD_INPUT_SIZE, SCRFD_INPUT_SIZE);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  // Black padding, as in scrfd.py (a zero-filled det_img).
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SCRFD_INPUT_SIZE, SCRFD_INPUT_SIZE);
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (bitmap !== image) bitmap.close();

  const { data } = ctx.getImageData(0, 0, SCRFD_INPUT_SIZE, SCRFD_INPUT_SIZE);
  const plane = SCRFD_INPUT_SIZE * SCRFD_INPUT_SIZE;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = ((data[i * 4] ?? 0) - 127.5) / 128;
    input[plane + i] = ((data[i * 4 + 1] ?? 0) - 127.5) / 128;
    input[2 * plane + i] = ((data[i * 4 + 2] ?? 0) - 127.5) / 128;
  }
  return { tensor: new ort.Tensor('float32', input, [1, 3, SCRFD_INPUT_SIZE, SCRFD_INPUT_SIZE]), scale };
}

// Picks the score and box outputs for each stride by shape rather than by
// position or name (both differ between SCRFD exports): [anchors, 1] is a
// score map, [anchors, 4] a box map, and the anchor count gives the stride.
// Anything missing throws, so the image is withheld (fail closed).
function toLevels(outputs: ort.InferenceSession.ReturnType): ScrfdOutputs {
  const tensors = Object.values(outputs);
  return SCRFD_STRIDES.map((stride) => {
    const anchors = (SCRFD_INPUT_SIZE / stride) ** 2 * 2;
    const scores = tensors.find((t) => t.dims[0] === anchors && t.dims[1] === 1);
    const distances = tensors.find((t) => t.dims[0] === anchors && t.dims[1] === 4);
    if (!scores || !distances) throw new Error(`scrfd output missing for stride ${stride}`);
    return { stride, scores: scores.data as Float32Array, distances: distances.data as Float32Array };
  });
}

self.onmessage = async (event: MessageEvent<InMessage>) => {
  const msg = event.data;

  if (msg.type === 'init') {
    try {
      await loadSession(msg);
      post({ type: 'ready' });
    } catch (error) {
      post({ type: 'init-error', message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  try {
    if (!sessionPromise) throw new Error('worker received detect before init');
    const session = await sessionPromise;
    const { tensor, scale } = await toInputTensor(msg.image);
    const inputName = session.inputNames[0];
    if (!inputName) throw new Error('scrfd model has no input');
    const outputs = await session.run({ [inputName]: tensor });
    const detections = decodeScrfd(toLevels(outputs), { scale, imageWidth: msg.image.width, imageHeight: msg.image.height });
    post({
      type: 'detect-result',
      id: msg.id,
      result: detections.map((d) => ({ box: d.box, confidence: bucketFaceScore(d.score) })),
    });
  } catch (error) {
    post({ type: 'detect-error', id: msg.id, message: error instanceof Error ? error.message : String(error) });
  } finally {
    // Release this worker's structured-clone copy of the pixels now (§2.8).
    if (msg.image instanceof ImageBitmap) msg.image.close();
  }
};
