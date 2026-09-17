// §12.4: maps backend ids to factories. M4 pulls this forward from M6 (originally
// scoped there, see docs/MILESTONES.md M2 Log) with only the test-only 'mock'
// entry so the canary e2e test has a real getBackend() to call. M6 adds
// 'llm:groq' / 'http:*' entries here — no rework of the registry itself.

import { MockAgentBackend } from './mock';
import type { AgentBackend } from './types';

export const backendFactories: Record<string, () => AgentBackend> = {
  mock: () => new MockAgentBackend(),
};
