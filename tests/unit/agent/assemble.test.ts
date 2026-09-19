// §14 assembler + §14.5 final guard.

import { describe, expect, it } from 'vitest';
import { assembleObservation, type AssembleInput } from '@/agent/assemble';
import type { SkeletonNode } from '@/dom/types';

function baseInput(overrides: Partial<AssembleInput> = {}): AssembleInput {
  return {
    session_id: 's1',
    step: 0,
    task: 'fill the form',
    page: { url: 'https://example.com/', title: 'Example', viewport: { w: 100, h: 100 }, scroll: { x: 0, y: 0 } },
    skeleton: [],
    contentResults: [],
    ...overrides,
  };
}

const textNode: SkeletonNode = {
  node_id: 'n1',
  tag: '#text',
  node_type: 'text',
  parent_id: null,
  bbox: { x: 0, y: 0, w: 10, h: 10 },
  visible: true,
  in_viewport: true,
  pending_content: ['text'],
};

describe('assembleObservation', () => {
  it('merges sanitized content into the dom tree by (node_id, field)', () => {
    const result = assembleObservation(
      baseInput({
        skeleton: [textNode],
        contentResults: [{ node_id: 'n1', field: 'text', text: 'hello world' }],
      }),
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    const { node_id, tag, node_type, parent_id, bbox, visible, in_viewport } = textNode;
    expect(result.observation.dom).toEqual([
      { node_id, tag, node_type, parent_id, bbox, visible, in_viewport, content: { text: 'hello world' } },
    ]);
  });

  it('reassembles windowed text results in order', () => {
    const result = assembleObservation(
      baseInput({
        skeleton: [textNode],
        contentResults: [
          { node_id: 'n1', field: 'text', text: 'a'.repeat(2000) },
          { node_id: 'n1', field: 'text', text: 'b'.repeat(1950) },
        ],
      }),
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.observation.dom[0]?.content.text).toBe('a'.repeat(2000) + 'b'.repeat(1900));
  });

  it('hardcodes [SECRET] for a secret field and never surfaces sanitized content for it', () => {
    const secretNode: SkeletonNode = {
      node_id: 'n2',
      tag: 'input',
      node_type: 'element',
      parent_id: null,
      bbox: { x: 0, y: 0, w: 10, h: 10 },
      visible: true,
      in_viewport: true,
      secret: true,
      pending_content: [],
    };
    const result = assembleObservation(baseInput({ skeleton: [secretNode] }));
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.observation.dom[0]?.content.value).toBe('[SECRET]');
  });

  it('produces images: [] and history: [] for M5', () => {
    const result = assembleObservation(baseInput());
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.observation.images).toEqual([]);
    expect(result.observation.history).toEqual([]);
  });

  it('blocks the step when a Tier-1 regex still matches after sanitization (§14.5)', () => {
    const result = assembleObservation(
      baseInput({
        skeleton: [textNode],
        // Simulates a pipeline bug: raw PII slipped through un-tokenized.
        contentResults: [{ node_id: 'n1', field: 'text', text: 'contact priya.sharma.canary@example.com' }],
      }),
    );
    expect(result).toEqual({ status: 'blocked' });
  });

  it('does not block on a random session_id that happens to satisfy a Tier-1 regex + checksum by chance', () => {
    // A real occurrence: a crypto.randomUUID() session id whose hex/hyphen
    // run coincidentally passed the Luhn check, false-triggering a naive
    // "scan the whole JSON" guard even though session_id is never content.
    const result = assembleObservation(
      baseInput({ session_id: '4111-1111-1111-1111-000000000000', skeleton: [], contentResults: [] }),
    );
    expect(result.status).toBe('ok');
  });

  it('does not block on an already-tokenized value', () => {
    const result = assembleObservation(
      baseInput({
        skeleton: [textNode],
        contentResults: [{ node_id: 'n1', field: 'text', text: 'contact [PII_EMAIL_1]' }],
      }),
    );
    expect(result.status).toBe('ok');
  });
});
