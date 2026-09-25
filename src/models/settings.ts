// §9.4: "the user may override [model selection] in settings" (M11). One
// provider id per capability, stored in extension storage and read once at
// compute-host start (computeHost.ts). Holds ids only -- never content.

import type { Capability } from './capabilities';
import type { KeyValueStore } from '@/platform/types';

export interface ModelSettings {
  overrides: Partial<Record<Capability, string>>; // e.g. { face: 'face/scrfd-2.5g' }
}

// Exported (via index.ts) so the settings page and the __EDWARD_E2E__ hook
// in content.ts can write the same key.
export const MODEL_SETTINGS_STORAGE_KEY = 'edward.modelSettings';

const DEFAULT_SETTINGS: ModelSettings = { overrides: {} };

export async function getModelSettings(store: KeyValueStore): Promise<ModelSettings> {
  return (await store.get<ModelSettings>(MODEL_SETTINGS_STORAGE_KEY)) ?? DEFAULT_SETTINGS;
}

export async function setModelSettings(store: KeyValueStore, settings: ModelSettings): Promise<void> {
  await store.set(MODEL_SETTINGS_STORAGE_KEY, settings);
}
