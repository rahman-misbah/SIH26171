export type * from './types';
export { getBackend } from './registry';
export { configureBackendDeps, type BackendDeps } from './deps';
export { getBackendSettings, setBackendSettings, type BackendSettings, type LlmProvider, type LlmProviderSettings } from './settings';
export { MOCK_SCRIPT_STORAGE_KEY } from './mock';

// HttpAgentBackend (§12.3) is M11 scope, per docs/MILESTONES.md.
