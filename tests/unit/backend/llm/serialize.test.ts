// §12.2: "serializes the observation to one TextContent (compact JSON with
// an image index img_id -> node_id), then one ImageContent per image in the
// same order".

import { describe, expect, it } from 'vitest';
import { buildModelRequest } from '@/backend/llm/serialize';
import type { SanitizedObservation } from '@/backend/types';

function baseObservation(overrides: Partial<SanitizedObservation> = {}): SanitizedObservation {
  return {
    schema_version: '1',
    session_id: 's1',
    step: 1,
    task: 'fill the form',
    page: { url: 'https://example.com/', title: 'Example', viewport: { w: 100, h: 100 }, scroll: { x: 0, y: 0 } },
    dom: [],
    images: [],
    history: [],
    ...overrides,
  };
}

describe('buildModelRequest', () => {
  it('puts the system prompt on the request', () => {
    const req = buildModelRequest(baseObservation(), 'you are edward');
    expect(req.system).toBe('you are edward');
    expect(req.wantJson).toBe(true);
  });

  it('serializes the observation as one text item when there are no images', () => {
    const req = buildModelRequest(baseObservation(), 'sys');
    expect(req.items).toHaveLength(1);
    expect(req.items[0]?.kind).toBe('text');
    const text = req.items[0]!.kind === 'text' ? req.items[0]!.text : '';
    const parsed = JSON.parse(text) as { session_id: string; task: string; image_index: Record<string, string> };
    expect(parsed.session_id).toBe('s1');
    expect(parsed.task).toBe('fill the form');
    expect(parsed.image_index).toEqual({});
  });

  it('adds an image_index entry and one ImageContent per image, same order', () => {
    const req = buildModelRequest(
      baseObservation({
        images: [
          { img_id: 'img1', node_id: 'n5', mime: 'image/png', data: new Uint8Array([1, 2]) },
          { img_id: 'img2', node_id: 'n9', mime: 'image/jpeg', data: new Uint8Array([3, 4]) },
        ],
      }),
      'sys',
    );
    expect(req.items).toHaveLength(3);
    const text = req.items[0]!.kind === 'text' ? req.items[0]!.text : '';
    const parsed = JSON.parse(text) as { image_index: Record<string, string> };
    expect(parsed.image_index).toEqual({ img1: 'n5', img2: 'n9' });
    expect(req.items[1]).toEqual({ kind: 'image', mime: 'image/png', data: new Uint8Array([1, 2]) });
    expect(req.items[2]).toEqual({ kind: 'image', mime: 'image/jpeg', data: new Uint8Array([3, 4]) });
  });

  it('never includes raw image bytes inside the text item', () => {
    const req = buildModelRequest(
      baseObservation({ images: [{ img_id: 'img1', node_id: 'n5', mime: 'image/png', data: new Uint8Array([9, 9]) }] }),
      'sys',
    );
    const text = req.items[0]!.kind === 'text' ? req.items[0]!.text : '';
    expect(text).not.toContain('data');
  });
});
