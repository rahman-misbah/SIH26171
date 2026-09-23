// §9.3, §9.6: runs inside a dedicated Worker, loads the model once, and
// answers one 'batch' message per micro-batch flush with exactly one
// Transformers.js inference call over the whole batch (§2.5 -- never one
// call per text, never a whole-document concatenation). A standard Worker,
// not an extension API, so this file isn't subject to the src/platform/
// boundary (§4.2) even though it only ever runs inside the compute host.
//
// §4.3.3: no remote code -- both the model weights (env.localModelPath) and
// the ONNX Runtime Web wasm binaries (env.backends.onnx.wasm.wasmPaths) are
// pointed at extension-bundled paths instead of the library's CDN defaults.
// Offsets: see alignTokens.ts's header for why raw Transformers.js output
// has to be re-aligned to the original text at all.

import { env, pipeline, type TokenClassificationPipeline } from '@huggingface/transformers';
import { alignTokensToText, groupAlignedTokens, type RawNerToken } from './alignTokens';
import { bucketConfidence, mapRawLabel } from './labelMap';

interface InitMessage {
  type: 'init';
  modelsBaseUrl: string; // e.g. "chrome-extension://<id>/models/"
  ortWasmBaseUrl: string; // e.g. "chrome-extension://<id>/ort/"
  compute: 'webgpu' | 'wasm';
}
interface BatchMessage {
  type: 'batch';
  id: number;
  texts: string[];
}
type InMessage = InitMessage | BatchMessage;

interface ReadyMessage {
  type: 'ready';
}
interface InitErrorMessage {
  type: 'init-error';
  message: string;
}
interface BatchResultMessage {
  type: 'batch-result';
  id: number;
  results: { start: number; end: number; label: string; confidence: 'low' | 'medium' | 'high' }[][];
}
interface BatchErrorMessage {
  type: 'batch-error';
  id: number;
  message: string;
}
type OutMessage = ReadyMessage | InitErrorMessage | BatchResultMessage | BatchErrorMessage;

function post(msg: OutMessage): void {
  // tsconfig's `lib` is DOM-only (no WebWorker) -- see .wxt/tsconfig.json --
  // so `self` types as `Window`, whose postMessage(message, targetOrigin,
  // transfer?) signature doesn't match a worker's postMessage(message,
  // transfer?). The cast is purely a typing workaround; at runtime this file
  // only ever executes inside a real DedicatedWorkerGlobalScope.
  (self as unknown as Worker).postMessage(msg);
}

let classifierPromise: Promise<TokenClassificationPipeline> | undefined;

function loadClassifier(init: InitMessage): Promise<TokenClassificationPipeline> {
  classifierPromise ??= (async () => {
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = init.modelsBaseUrl;
    // `wasm` itself is a readonly property (can't reassign the object), and
    // typed optional only because TransformersEnvironment declares it as
    // `Partial<onnxruntime-common Env>` -- onnxruntime-web always populates
    // it before user code runs, but the guard keeps this correct either way.
    if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = init.ortWasmBaseUrl;
    return pipeline('token-classification', 'ner', {
      dtype: 'q8',
      device: init.compute === 'webgpu' ? 'webgpu' : 'wasm',
    });
  })();
  return classifierPromise;
}

self.onmessage = async (event: MessageEvent<InMessage>) => {
  const msg = event.data;

  if (msg.type === 'init') {
    try {
      await loadClassifier(msg);
      post({ type: 'ready' });
    } catch (error) {
      post({ type: 'init-error', message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  // 'batch'
  try {
    if (!classifierPromise) throw new Error('worker received a batch before init');
    const classifier = await classifierPromise;

    // One batched inference call for the whole micro-batch (§2.5/§9.6).
    // Transformers.js's own return type for an array input with
    // `ignore_labels: []` is looser than the concrete {entity,score,word}[][]
    // shape confirmed against a real run (alignTokens.test.ts's captured
    // token stream) -- cast to the shape this file's alignment code expects.
    const rawPerText = (await classifier(msg.texts, { ignore_labels: [] })) as unknown as RawNerToken[][];

    const results = msg.texts.map((text, i) => {
      const aligned = alignTokensToText(text, rawPerText[i] ?? []);
      const grouped = groupAlignedTokens(aligned);
      return grouped.flatMap((g) => {
        const type = mapRawLabel(g.label);
        if (type === null) return []; // e.g. ORGANIZATION -- not PII (§7.2)
        return [{ start: g.start, end: g.end, label: type, confidence: bucketConfidence(g.score) }];
      });
    });

    post({ type: 'batch-result', id: msg.id, results });
  } catch (error) {
    post({ type: 'batch-error', id: msg.id, message: error instanceof Error ? error.message : String(error) });
  }
};
