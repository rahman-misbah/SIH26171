export type * from './types';
export { getBackend } from './registry';

// llm/http entries in backends.config arrive in M6 (SPEC §12); only the M4
// test-only 'mock' backend is registered so far (docs/MILESTONES.md M4 Log).
