// §9.4: which providers to try for a capability, in order. The first one
// that loads wins; the rest are the fallbacks the registry drops to if it
// fails to load (M11). Pure, so both compute decisions can be unit-tested.

import type { Capability } from './capabilities';
import type { ModelProvider } from './provider';

// minMemoryGB isn't checked: ModelDeps carries only the §10 compute
// decision, not deviceMemoryGB, and no provider sets minMemoryGB (SCRFD is
// ~3 MB), so this stays a documented gap.
function isSatisfied(requires: ModelProvider<Capability>['requires'], compute: 'webgpu' | 'wasm'): boolean {
  if (requires.webgpu && compute !== 'webgpu') return false;
  return true;
}

export function candidateProviders<C extends Capability>(
  providers: ModelProvider<C>[],
  compute: 'webgpu' | 'wasm',
  overrideId?: string,
): { candidates: ModelProvider<C>[]; overrideUnknown: boolean } {
  // Automatic order: models.config.ts preference order (highest tier
  // first), keeping only providers the hardware can run.
  const automatic = providers.filter((p) => isSatisfied(p.requires, compute));
  if (overrideId === undefined) return { candidates: automatic, overrideUnknown: false };

  const chosen = providers.find((p) => p.id === overrideId);
  if (!chosen) return { candidates: automatic, overrideUnknown: true };

  // The override skips the `requires` check: it's an explicit user choice
  // (M11 decision, e.g. SCRFD on wasm -- slower but it runs). If it fails
  // to load, the automatic order still applies after it.
  return { candidates: [chosen, ...automatic.filter((p) => p !== chosen)], overrideUnknown: false };
}
