// §9.3/§9.4: a provider's load(ctx) needs the hardware compute decision
// (§10), an assetUrl() resolver (bundled weights, never CDN, §4.3.3) and a
// logger -- but getModel(capability) is a synchronous-shaped, zero-argument
// lookup by design (§9.4's "analogous to get_client()"), so these can't be
// constructor parameters threaded through the registry. Configured once by
// bootstrapComputeHost() before any consumer can call getModel(); mirrors
// the module-singleton pattern src/backend/deps.ts already uses.

import type { ComputeTarget } from '@/hw/types';
import type { Capability } from './capabilities';
import type { RuntimeLogger } from '@/logging';

export interface ModelDeps {
  compute: ComputeTarget;
  assetUrl: (path: string) => string;
  logger: RuntimeLogger;
  // The compute-host-lifetime SessionRecord this process logged at startup
  // (src/core/computeHost.ts) -- getModel() reports each load against it via
  // logger.recordModelLoad(), not against any per-task agent session_id.
  session_id: string;
  // §9.4 user override (M11): provider id per capability, from the model
  // settings (settings.ts). Read once at compute-host start.
  overrides?: Partial<Record<Capability, string>>;
}

let deps: ModelDeps | undefined;
let resolveReady: (() => void) | undefined;
// Unlike configureBackendDeps() (called synchronously, before any `await`,
// so no dispatched request can possibly race it -- JS doesn't yield control
// until then), configureModelDeps() needs `device.compute`, only available
// after an async detectDevice() call -- so a request genuinely can arrive
// (and call getModel()) in the gap between the dispatch handler being
// registered and this module being configured. Found as a real, intermittent
// e2e failure ("model deps not configured") while building M7; getModelDeps()
// awaits readiness instead of racing it, rather than a synchronous
// throw-if-not-yet-configured contract that can't be met here.
const ready = new Promise<void>((resolve) => {
  resolveReady = resolve;
});

export function configureModelDeps(next: ModelDeps): void {
  deps = next;
  resolveReady?.();
}

export async function getModelDeps(): Promise<ModelDeps> {
  await ready;
  if (!deps) throw new Error('model deps not configured -- bootstrapComputeHost() must run before getModel()');
  return deps;
}
