// M4 test harness: a real AgentBackend (§12.1) that never leaves the device.
// Used by the canary leak e2e test (§18.1) to capture whatever observation
// the current pipeline produces, and by the M6 agent-loop e2e test
// (tests/e2e/agentLoop.spec.ts), which needs deterministic actions without a
// live Groq/custom backend -- when constructed with a settings store, it
// replays a queue of canned AgentResponses a test seeds into extension
// storage (never anything a real build writes to), falling back to its
// original no-op behaviour once the queue is empty or absent.

import type { AgentResponse } from '@/agent/schema';
import type { KeyValueStore } from '@/platform/types';
import type { AgentBackend, BackendCapabilities, SanitizedObservation } from './types';

const CAPABILITIES: BackendCapabilities = {
  maxImagesPerRequest: 4,
  maxImageBytes: 5 * 1024 * 1024,
  maxContextTokens: 8192,
};

// Exported (via src/backend/index.ts) only so the __EDWARD_E2E__-gated hook
// in src/entrypoints/content.ts can seed this same key without importing
// this file directly, which Boundary C forbids outside src/backend/.
export const MOCK_SCRIPT_STORAGE_KEY = 'edward.e2e.mockScript';

export class MockAgentBackend implements AgentBackend {
  readonly id = 'mock';
  readonly capabilities = CAPABILITIES;
  readonly observations: SanitizedObservation[] = [];

  constructor(private readonly settings?: KeyValueStore) {}

  async init(): Promise<void> {}

  async decide(obs: SanitizedObservation): Promise<AgentResponse> {
    this.observations.push(obs);
    return (await this.nextScriptedResponse()) ?? { thought: 'mock backend: no-op', actions: [], done: true };
  }

  private async nextScriptedResponse(): Promise<AgentResponse | undefined> {
    if (!this.settings) return undefined;
    const queue = await this.settings.get<AgentResponse[]>(MOCK_SCRIPT_STORAGE_KEY);
    if (!queue || queue.length === 0) return undefined;
    const [next, ...rest] = queue;
    await this.settings.set(MOCK_SCRIPT_STORAGE_KEY, rest);
    return next;
  }
}
