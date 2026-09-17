import { describe, expect, it } from 'vitest';
import { isAgentResponse } from '@/agent/schema';
import { MockAgentBackend } from '@/backend/mock';
import type { SanitizedObservation } from '@/backend';

function observation(overrides: Partial<SanitizedObservation> = {}): SanitizedObservation {
  return {
    schema_version: '1',
    session_id: 'session-1',
    step: 0,
    task: 'do the thing',
    page: { url: 'https://example.com', title: 'Example', viewport: { w: 0, h: 0 }, scroll: { x: 0, y: 0 } },
    dom: [],
    images: [],
    history: [],
    ...overrides,
  };
}

describe('MockAgentBackend', () => {
  it('records every observation it decides on', async () => {
    const backend = new MockAgentBackend();
    await backend.decide(observation({ step: 0 }));
    await backend.decide(observation({ step: 1 }));

    expect(backend.observations).toHaveLength(2);
    expect(backend.observations.map((obs) => obs.step)).toEqual([0, 1]);
  });

  it('returns a valid AgentResponse', async () => {
    const backend = new MockAgentBackend();
    const response = await backend.decide(observation());
    expect(isAgentResponse(response)).toBe(true);
  });
});
