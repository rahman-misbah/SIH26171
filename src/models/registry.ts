// §9.4: getModel(capability) -- lazy singleton, analogous to get_client().
// Selection: the highest tier (preference order in models.config.ts) whose
// `requires` the hardware profile satisfies. Runtime/load failure fails
// closed: the affected capability falls back to an empty-result
// implementation (never silently passed through) and is logged; for NER
// specifically the regex tier still runs independently upstream (§7.1), so
// an empty NER result here is a graceful degradation of recall, not a
// privacy bypass.

import { ReasonCodeError } from '@/logging';
import { modelProviders } from './models.config';
import { getModelDeps } from './deps';
import type { Capability } from './capabilities';
import type { CapabilityImpl, ModelProvider } from './provider';

const instances = new Map<Capability, Promise<unknown>>();

// minMemoryGB isn't checked: ModelDeps only carries the §10 compute decision
// (webgpu/wasm), not deviceMemoryGB -- no provider in this milestone sets
// minMemoryGB (only M8/M9's tier-2 providers are expected to), so this is a
// documented gap to close then rather than plumbed speculatively now.
function isSatisfied(requires: ModelProvider<Capability>['requires'], compute: 'webgpu' | 'wasm'): boolean {
  if (requires.webgpu && compute !== 'webgpu') return false;
  return true;
}

function selectProvider<C extends Capability>(capability: C, compute: 'webgpu' | 'wasm'): ModelProvider<C> | undefined {
  const candidates = modelProviders[capability];
  return candidates.find((p) => isSatisfied(p.requires, compute));
}

// Only 'ner' has a consumer this milestone (§7.2's pass-through-shaped
// fallback); face/ocr/qr have none until M8/M9, so there is nothing safe to
// guess at yet -- fail loud rather than fabricate a shape no one has designed.
function fallbackImpl<C extends Capability>(capability: C): CapabilityImpl<C> {
  if (capability === 'ner') {
    return { tag: async (texts: string[]) => texts.map(() => []) } as unknown as CapabilityImpl<C>;
  }
  throw new Error(`getModel('${capability}'): no provider available and no fallback implementation exists yet`);
}

async function loadModel<C extends Capability>(capability: C): Promise<CapabilityImpl<C>> {
  const deps = await getModelDeps();
  const provider = selectProvider(capability, deps.compute);

  if (!provider) {
    const now = performance.timeOrigin + performance.now();
    deps.logger.record({
      session_id: deps.session_id,
      op: 'model.load',
      t_start: now,
      t_end: now,
      duration_ms: 0,
      outcome: 'fail_closed',
      reason: 'model_load_failed',
    });
    return fallbackImpl(capability);
  }

  try {
    const impl = await deps.logger.timed(
      'model.load',
      { session_id: deps.session_id, model_id: provider.id, tier: provider.tier, compute: deps.compute },
      async () => {
        try {
          return await provider.load({
            compute: deps.compute,
            assetUrl: deps.assetUrl,
            logger: deps.logger,
            session_id: deps.session_id,
          });
        } catch (error) {
          throw new ReasonCodeError('model_load_failed', error instanceof Error ? error.message : String(error));
        }
      },
    );
    deps.logger.recordModelLoad(deps.session_id, {
      capability,
      model_id: provider.id,
      tier: provider.tier,
      compute: deps.compute,
    });
    return impl;
  } catch {
    // logger.timed() already recorded the 'fail' outcome/reason and rethrew.
    return fallbackImpl(capability);
  }
}

export function getModel<C extends Capability>(capability: C): Promise<CapabilityImpl<C>> {
  const existing = instances.get(capability);
  if (existing) return existing as Promise<CapabilityImpl<C>>;

  const promise = loadModel(capability);
  instances.set(capability, promise);
  return promise;
}
