// §12.4: backend/provider selection persisted in extension storage (never
// content, never logged -- CLAUDE.md/§12.7: "acceptable for a demo, state it
// in the slides"). Read by the settings page (writer) and by
// backends.config.ts's llm:* factories (reader, inside init()).

import type { KeyValueStore } from '@/platform/types';

export type LlmProvider = 'groq' | 'openai-compatible';

export interface LlmProviderSettings {
  apiKey: string;
  model?: string;
  baseUrl?: string; // required for 'openai-compatible'; groq's endpoint is fixed
}

export interface HttpBackendSettings {
  endpoint: string; // §12.4: HTTPS, or http://localhost for development (http/endpoint.ts)
  token?: string; // optional Bearer token (§12.7)
}

export interface BackendSettings {
  // 'mock' | 'llm:groq' | 'llm:openai-compatible' | 'http:custom' -- matches backends.config.ts's keys.
  selectedBackendId: string;
  llm: Partial<Record<LlmProvider, LlmProviderSettings>>;
  http?: HttpBackendSettings; // M11, §12.3
}

const STORAGE_KEY = 'edward.backendSettings';

const DEFAULT_SETTINGS: BackendSettings = { selectedBackendId: 'mock', llm: {} };

export async function getBackendSettings(store: KeyValueStore): Promise<BackendSettings> {
  return (await store.get<BackendSettings>(STORAGE_KEY)) ?? DEFAULT_SETTINGS;
}

export async function setBackendSettings(store: KeyValueStore, settings: BackendSettings): Promise<void> {
  await store.set(STORAGE_KEY, settings);
}
