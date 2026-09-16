import { describe, expect, it } from 'vitest';
import {
  isAgentResponse,
  MAX_ACTIONS_PER_STEP,
  MAX_THOUGHT_LENGTH,
  MAX_WAIT_MS,
  type AgentResponse,
} from '@/agent/schema';

function valid(overrides: Partial<AgentResponse> = {}): AgentResponse {
  return { thought: 'looking for the button', actions: [], done: false, ...overrides };
}

describe('isAgentResponse', () => {
  it('accepts a minimal valid response', () => {
    expect(isAgentResponse(valid())).toBe(true);
  });

  it('accepts a done response with an answer', () => {
    expect(isAgentResponse(valid({ done: true, answer: 'the total is [PII_CARD_1]' }))).toBe(true);
  });

  it.each([
    { type: 'click', node_id: 'n1' },
    { type: 'type', node_id: 'n1', text: 'hello' },
    { type: 'type', node_id: 'n1', text: 'hello', submit: true },
    { type: 'select', node_id: 'n1', value: 'opt1' },
    { type: 'scroll', direction: 'up' },
    { type: 'scroll', direction: 'down' },
    { type: 'scroll_to', node_id: 'n1' },
    { type: 'navigate', url: 'https://example.com' },
    { type: 'wait', ms: 1000 },
    { type: 'wait', ms: MAX_WAIT_MS },
  ])('accepts each valid action shape: %j', (action) => {
    expect(isAgentResponse(valid({ actions: [action as never] }))).toBe(true);
  });

  it('rejects a non-object value', () => {
    expect(isAgentResponse(null)).toBe(false);
    expect(isAgentResponse('nope')).toBe(false);
    expect(isAgentResponse([])).toBe(false);
  });

  it('rejects a missing thought', () => {
    const rest: Record<string, unknown> = { ...valid() };
    delete rest.thought;
    expect(isAgentResponse(rest)).toBe(false);
  });

  it(`rejects a thought longer than ${MAX_THOUGHT_LENGTH} chars`, () => {
    expect(isAgentResponse(valid({ thought: 'x'.repeat(MAX_THOUGHT_LENGTH + 1) }))).toBe(false);
  });

  it(`rejects more than ${MAX_ACTIONS_PER_STEP} actions`, () => {
    const actions = Array.from({ length: MAX_ACTIONS_PER_STEP + 1 }, () => ({
      type: 'click' as const,
      node_id: 'n1',
    }));
    expect(isAgentResponse(valid({ actions }))).toBe(false);
  });

  it('rejects a non-boolean done', () => {
    expect(isAgentResponse({ ...valid(), done: 'true' })).toBe(false);
  });

  it('rejects a non-string answer', () => {
    expect(isAgentResponse({ ...valid(), answer: 42 })).toBe(false);
  });

  it('rejects an unknown action type', () => {
    expect(isAgentResponse(valid({ actions: [{ type: 'drag_and_drop' } as never] }))).toBe(false);
  });

  it('rejects an action missing a required field', () => {
    expect(isAgentResponse(valid({ actions: [{ type: 'click' } as never] }))).toBe(false);
  });

  it(`rejects a wait action over ${MAX_WAIT_MS}ms`, () => {
    expect(isAgentResponse(valid({ actions: [{ type: 'wait', ms: MAX_WAIT_MS + 1 }] }))).toBe(
      false
    );
  });

  it('rejects an action with the wrong field type', () => {
    expect(
      isAgentResponse(valid({ actions: [{ type: 'type', node_id: 'n1', text: 42 } as never] }))
    ).toBe(false);
  });
});
