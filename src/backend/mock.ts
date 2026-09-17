// M4 test harness: a real AgentBackend (§12.1) that never leaves the device.
// Used only by the canary leak e2e test (§18.1) to capture whatever observation
// the current pipeline produces, without needing a live Groq/custom backend.

import type { AgentResponse } from '@/agent/schema';
import type { AgentBackend, BackendCapabilities, SanitizedObservation } from './types';

const CAPABILITIES: BackendCapabilities = {
  maxImagesPerRequest: 4,
  maxImageBytes: 5 * 1024 * 1024,
  maxContextTokens: 8192,
};

export class MockAgentBackend implements AgentBackend {
  readonly id = 'mock';
  readonly capabilities = CAPABILITIES;
  readonly observations: SanitizedObservation[] = [];

  async init(): Promise<void> {}

  async decide(obs: SanitizedObservation): Promise<AgentResponse> {
    this.observations.push(obs);
    return { thought: 'mock backend: no-op', actions: [], done: true };
  }
}
