// §9.4: getModel(capability) -- lazy singleton, analogous to get_client().
// Selection (select.ts): the highest tier (preference order in
// models.config.ts) whose `requires` the hardware profile satisfies, unless
// the model settings override it. A provider that fails to load hands over
// to the next candidate (M11); if none loads, the capability fails closed:
// it falls back to a rejecting (face/ocr/qr) or empty (ner) implementation
// and is logged, never silently passed through. For NER the regex tier
// still runs independently upstream (§7.1), so an empty NER result is a
// graceful degradation of recall, not a privacy bypass.

import { ReasonCodeError } from '@/logging';
import type { LogRecord } from '@/logging';
import { modelProviders } from './models.config';
import { getModelDeps, type ModelDeps } from './deps';
import { candidateProviders } from './select';
import type { Capability } from './capabilities';
import type { CapabilityImpl, ModelProvider } from './provider';

const instances = new Map<Capability, Promise<unknown>>();
// Provider id per capability, set only once that provider actually loaded --
// a capability running on its fail-closed fallback has no entry.
const activeProviderIds = new Map<Capability, string>();

// What a capability falls back to when no provider is available or its load
// failed (§9.4: "the affected item fails closed"):
// - ner: an empty result -- the regex tier still runs independently upstream
//   (§7.1), so this degrades recall rather than bypassing sanitization.
// - face/ocr/qr: every call *rejects* with `detector_failed`, so the image
//   pipeline withholds the image (§6.4.6) instead of treating "found nothing"
//   as "nothing to redact". An empty list here would pass a face straight
//   through as clean -- exactly what §2.1 forbids.
function detectorFailed(): Promise<never> {
  return Promise.reject(new ReasonCodeError('detector_failed'));
}

function fallbackImpl<C extends Capability>(capability: C): CapabilityImpl<C> {
  switch (capability) {
    case 'ner':
      return { tag: async (texts: string[]) => texts.map(() => []) } as unknown as CapabilityImpl<C>;
    case 'ocr':
      return { read: detectorFailed } as unknown as CapabilityImpl<C>;
    default: // 'face' | 'qr'
      return { detect: detectorFailed } as unknown as CapabilityImpl<C>;
  }
}

function logNow(deps: ModelDeps, record: Omit<LogRecord, 'session_id' | 't_start' | 't_end' | 'duration_ms'>): void {
  const now = performance.timeOrigin + performance.now();
  deps.logger.record({ session_id: deps.session_id, t_start: now, t_end: now, duration_ms: 0, ...record });
}

// Loads one provider; undefined if it failed (logger.timed() has already
// recorded the 'fail' outcome and reason).
async function tryLoad<C extends Capability>(provider: ModelProvider<C>, deps: ModelDeps): Promise<CapabilityImpl<C> | undefined> {
  const compute = provider.effectiveCompute?.(deps.compute) ?? deps.compute;
  try {
    const impl = await deps.logger.timed(
      'model.load',
      { session_id: deps.session_id, model_id: provider.id, tier: provider.tier, compute },
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
    deps.logger.recordModelLoad(deps.session_id, { capability: provider.capability, model_id: provider.id, tier: provider.tier, compute });
    return impl;
  } catch {
    return undefined;
  }
}

async function loadModel<C extends Capability>(capability: C): Promise<CapabilityImpl<C>> {
  const deps = await getModelDeps();
  const { candidates, overrideUnknown } = candidateProviders(modelProviders[capability], deps.compute, deps.overrides?.[capability]);

  if (overrideUnknown) logNow(deps, { op: 'model.load', outcome: 'skipped', reason: 'model_override_unknown' });

  if (candidates.length === 0) {
    logNow(deps, { op: 'model.load', outcome: 'fail_closed', reason: 'model_load_failed' });
    return fallbackImpl(capability);
  }

  // §9.4 (M11): a provider that fails to load hands over to the next one in
  // order for the rest of the session -- e.g. SCRFD without a working
  // WebGPU device drops to BlazeFace instead of withholding every image.
  // A failure on a single item later stays fail-closed for that item.
  for (const [index, provider] of candidates.entries()) {
    const impl = await tryLoad(provider, deps);
    if (!impl) continue;
    if (index > 0) {
      logNow(deps, { op: 'model.downgrade', outcome: 'ok', reason: 'model_load_failed', model_id: provider.id, tier: provider.tier });
    }
    activeProviderIds.set(capability, provider.id);
    return impl;
  }

  // Every candidate failed: each failure is already logged.
  return fallbackImpl(capability);
}

export function getModel<C extends Capability>(capability: C): Promise<CapabilityImpl<C>> {
  const existing = instances.get(capability);
  if (existing) return existing as Promise<CapabilityImpl<C>>;

  const promise = loadModel(capability);
  instances.set(capability, promise);
  return promise;
}

// §6.6: the image cache key includes a detector_set_version that "changes
// whenever the active model tiers change" -- built from these ids. Loads the
// capability if needed; undefined means it's running on its fallback.
export async function getActiveModelId(capability: Capability): Promise<string | undefined> {
  await getModel(capability);
  return activeProviderIds.get(capability);
}
