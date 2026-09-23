// §9.3, §9.5: gravitee-io/bert-small-pii-detection, the tier-1 NER provider.
// Owns the one Worker this capability runs in (§9.6: "NER worker x1") and
// the micro-batcher (§2.5/§7.2: B=16 or T=10ms) that coalesces concurrent
// PiiNer.tag() calls from different ContentUnits into shared batched
// inference calls -- callers never see the batching, they just call
// `.tag([text])` per unit like the pass-through stub did.

import { createMicroBatcher } from '@/core/pool';
import type { Bucket, PiiNer } from '@/models/capabilities';
import type { ModelProvider } from '@/models/provider';
import { logEgressBlocked } from '../egressGuard';

// §7.2/§9.6 defaults.
const MICRO_BATCH_MAX = 16;
const MICRO_BATCH_MAX_WAIT_MS = 10;

type WorkerSpan = { start: number; end: number; label: string; confidence: Bucket };

interface InitAck {
  type: 'ready' | 'init-error';
  message?: string;
}
interface BatchAck {
  type: 'batch-result' | 'batch-error';
  id: number;
  results?: WorkerSpan[][];
  message?: string;
}
type WorkerAck = InitAck | BatchAck | { type: 'egress-blocked' };

export const graviteeBertSmallPii: ModelProvider<'ner'> = {
  id: 'ner/gravitee-bert-small-pii',
  capability: 'ner',
  tier: 1,
  requires: {}, // runs on wasm or webgpu (ONNX Runtime Web adapts, §9.5)
  approxDownloadMB: 29,

  async load(ctx): Promise<PiiNer> {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    // Attached before init, so a request refused during the model load is
    // logged too (see ../egressGuard.ts).
    worker.addEventListener('message', (event: MessageEvent<WorkerAck>) => {
      if (event.data.type === 'egress-blocked') {
        logEgressBlocked(ctx.logger, { session_id: ctx.session_id, op: 'sanitize.ner', model_id: graviteeBertSmallPii.id });
      }
    });

    await new Promise<void>((resolve, reject) => {
      function onMessage(event: MessageEvent<WorkerAck>): void {
        if (event.data.type === 'ready') {
          worker.removeEventListener('message', onMessage);
          resolve();
        } else if (event.data.type === 'init-error') {
          worker.removeEventListener('message', onMessage);
          reject(new Error(event.data.message ?? 'NER worker init failed'));
        }
      }
      worker.addEventListener('message', onMessage);
      worker.addEventListener(
        'error',
        (event) => reject(event.error instanceof Error ? event.error : new Error('NER worker failed to start')),
        { once: true },
      );
      worker.postMessage({
        type: 'init',
        modelsBaseUrl: ctx.assetUrl('/models/'),
        ortWasmBaseUrl: ctx.assetUrl('/ort/'),
        compute: ctx.compute,
      });
    });

    let nextId = 0;
    const pending = new Map<number, { resolve: (r: WorkerSpan[][]) => void; reject: (e: unknown) => void }>();

    worker.addEventListener('message', (event: MessageEvent<WorkerAck>) => {
      const msg = event.data;
      if (msg.type === 'batch-result') {
        pending.get(msg.id)?.resolve(msg.results ?? []);
        pending.delete(msg.id);
      } else if (msg.type === 'batch-error') {
        pending.get(msg.id)?.reject(new Error(msg.message ?? 'NER batch failed'));
        pending.delete(msg.id);
      }
    });

    const batcher = createMicroBatcher<string, WorkerSpan[]>({
      maxBatch: MICRO_BATCH_MAX,
      maxWaitMs: MICRO_BATCH_MAX_WAIT_MS,
      // §9.6: one `sanitize.ner` LogRecord per flushed micro-batch (real
      // inference call), not per text -- tagged with the compute-host
      // session (ctx.session_id), the same scope `model.load` uses, since a
      // batch can coalesce units from more than one agent-task session and
      // there's no single task session_id that would be more correct here.
      run: (texts) =>
        ctx.logger.timed(
          'sanitize.ner',
          { session_id: ctx.session_id, model_id: graviteeBertSmallPii.id, tier: 1, compute: ctx.compute, counts: { units: texts.length } },
          () =>
            new Promise<WorkerSpan[][]>((resolve, reject) => {
              const id = nextId++;
              pending.set(id, { resolve, reject });
              worker.postMessage({ type: 'batch', id, texts });
            }),
        ),
    });

    return {
      async tag(texts: string[]) {
        return Promise.all(texts.map((text) => batcher.submit(text)));
      },
    };
  },

  // No teardown path calls this yet (M7 has no session-end model-unload
  // concept -- getModel() is a compute-host-lifetime singleton, same as
  // getBackend()'s instances); left a documented no-op rather than threading
  // worker.terminate() through a second module-level handle nothing calls.
  async dispose(): Promise<void> {},
};
