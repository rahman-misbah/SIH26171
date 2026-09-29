import { describe, expect, it } from 'vitest';
import { parseInput } from '@/viewer/parseInput';

const node = (node_id: string, parent_id: string | null, extra: Record<string, unknown> = {}) => ({
  node_id,
  parent_id,
  tag: 'div',
  node_type: 'element',
  bbox: { x: 0, y: 0, w: 1, h: 1 },
  visible: true,
  in_viewport: true,
  content: {},
  ...extra,
});

const OBS = {
  schema_version: '1',
  session_id: 's',
  step: 2,
  task: 'Fill the email field with [PII_EMAIL_1]',
  page: { url: 'https://example.com/', title: 'Form', viewport: { w: 1, h: 1 }, scroll: { x: 0, y: 0 } },
  dom: [node('n1', null), node('n2', 'n1', { image: 'img' }), node('n3', 'n1', { image: 'img' })],
  history: [{ step: 1, thought: 'look', actions: [], results: [] }],
};

// What src/backend/llm/serialize.ts + clients/openaiCompatible.ts send.
function chatBody(imageIndex: Record<string, string>, urls: string[]) {
  return {
    model: 'm',
    messages: [
      { role: 'system', content: 'prompt' },
      {
        role: 'user',
        content: [
          { type: 'text', text: JSON.stringify({ ...OBS, image_index: imageIndex }) },
          ...urls.map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      },
    ],
  };
}

describe('parseInput (viewer demo tooling)', () => {
  it('reads a chat/completions body and pairs image parts with image_index in order', () => {
    const [obs] = parseInput(JSON.stringify(chatBody({ i1: 'n2', i2: 'n3' }, ['data:image/jpeg;base64,AAA', 'data:image/jpeg;base64,BBB'])));
    expect(obs?.task).toBe('Fill the email field with [PII_EMAIL_1]');
    expect(obs?.step).toBe(2);
    expect(obs?.page).toEqual({ url: 'https://example.com/', title: 'Form' });
    expect(obs?.dom).toHaveLength(3);
    expect(obs?.images).toEqual([
      { img_id: 'i1', node_id: 'n2', src: 'data:image/jpeg;base64,AAA' },
      { img_id: 'i2', node_id: 'n3', src: 'data:image/jpeg;base64,BBB' },
    ]);
    expect(obs?.history).toEqual([{ step: 1, thought: 'look' }]);
  });

  it('reads a wire-protocol observation with base64 image data', () => {
    const wire = { ...OBS, truncated: true, images: [{ img_id: 'i1', node_id: 'n2', mime: 'image/png', data: 'QUJD' }] };
    const [obs] = parseInput(JSON.stringify(wire));
    expect(obs?.images).toEqual([{ img_id: 'i1', node_id: 'n2', src: 'data:image/png;base64,QUJD' }]);
    expect(obs?.truncated).toBe(true);
  });

  it('reads every Edward request in a HAR file, skipping unrelated entries', () => {
    const har = {
      log: {
        entries: [
          { request: { url: 'https://example.com/a.png' } },
          { request: { postData: { text: JSON.stringify(chatBody({}, [])) } } },
          { request: { postData: { text: 'not json' } } },
          { request: { postData: { text: JSON.stringify({ ...OBS, step: 3, images: [] }) } } },
        ],
      },
    };
    expect(parseInput(JSON.stringify(har)).map((o) => o.step)).toEqual([2, 3]);
  });

  it('gives a readable error for anything else', () => {
    expect(() => parseInput('{')).toThrow(/valid JSON/);
    expect(() => parseInput('{"hello": 1}')).toThrow(/Edward request/);
    expect(() => parseInput(JSON.stringify({ log: { entries: [] } }))).toThrow(/No Edward requests/);
  });
});
