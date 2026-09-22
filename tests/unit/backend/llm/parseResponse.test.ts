// §12.2: "extract the first JSON object" from a ModelResponse's raw text,
// then validate against §13.1 (isAgentResponse). Models like Groq's
// thinking-mode Qwen wrap the JSON in reasoning text (`<think>...</think>`),
// so this must find a JSON object anywhere in the string, not require the
// whole string to be JSON.

import { describe, expect, it } from 'vitest';
import { parseAgentResponse } from '@/backend/llm/parseResponse';

const VALID = '{"thought":"clicking the button","done":false,"actions":[{"type":"click","node_id":"n1"}]}';

describe('parseAgentResponse', () => {
  it('parses a bare JSON response', () => {
    expect(parseAgentResponse(VALID)).toEqual({
      thought: 'clicking the button',
      done: false,
      actions: [{ type: 'click', node_id: 'n1' }],
    });
  });

  it('finds the JSON object after reasoning/thinking text', () => {
    const text = `<think>I should click the button because it's visible.</think>\n${VALID}`;
    expect(parseAgentResponse(text)).toEqual({
      thought: 'clicking the button',
      done: false,
      actions: [{ type: 'click', node_id: 'n1' }],
    });
  });

  it('finds the JSON object surrounded by markdown code fences', () => {
    expect(parseAgentResponse(`Here you go:\n\`\`\`json\n${VALID}\n\`\`\``)).toEqual({
      thought: 'clicking the button',
      done: false,
      actions: [{ type: 'click', node_id: 'n1' }],
    });
  });

  it('does not get confused by braces inside a string value', () => {
    const text = '{"thought":"click {the} button","done":true,"actions":[]}';
    expect(parseAgentResponse(text)).toEqual({ thought: 'click {the} button', done: true, actions: [] });
  });

  it('returns undefined for non-JSON text', () => {
    expect(parseAgentResponse('I will click the button now.')).toBeUndefined();
  });

  it('returns undefined for JSON that fails schema validation', () => {
    expect(parseAgentResponse('{"thought":"x","done":"not-a-boolean","actions":[]}')).toBeUndefined();
  });

  it('returns undefined for JSON that violates the actions-per-step cap', () => {
    const tooMany = JSON.stringify({
      thought: 'x',
      done: false,
      actions: [
        { type: 'click', node_id: 'n1' },
        { type: 'click', node_id: 'n2' },
        { type: 'click', node_id: 'n3' },
        { type: 'click', node_id: 'n4' },
      ],
    });
    expect(parseAgentResponse(tooMany)).toBeUndefined();
  });
});
