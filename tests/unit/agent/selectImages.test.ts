// §14.3 image selection: by backend.capabilities only, in-viewport first,
// then larger area, up to maxImagesPerRequest. Written before the
// implementation.

import { describe, expect, it } from 'vitest';
import { selectImages } from '@/agent/selectImages';
import type { SkeletonNode } from '@/dom/types';

function img(node_id: string, opts: { in_viewport?: boolean; w?: number; h?: number; visible?: boolean; omitted?: SkeletonNode['image_omitted'] } = {}): SkeletonNode {
  return {
    node_id,
    tag: 'img',
    node_type: 'element',
    parent_id: null,
    bbox: { x: 0, y: 0, w: opts.w ?? 100, h: opts.h ?? 100 },
    visible: opts.visible ?? true,
    in_viewport: opts.in_viewport ?? true,
    image: 'img',
    image_omitted: opts.omitted,
    pending_content: [],
  };
}

describe('selectImages', () => {
  it('puts in-viewport images first, then larger area, and cuts at the limit', () => {
    const skeleton = [
      img('off-big', { in_viewport: false, w: 900, h: 900 }),
      img('in-small', { w: 50, h: 50 }),
      img('in-big', { w: 400, h: 400 }),
      img('in-mid', { w: 200, h: 200 }),
    ];
    const available = new Set(skeleton.map((n) => n.node_id));
    expect(selectImages(skeleton, available, 3)).toEqual({
      selected: ['in-big', 'in-mid', 'in-small'],
      overLimit: ['off-big'],
      missing: [],
    });
  });

  it('keeps DOM order for equal priority and area', () => {
    const skeleton = [img('a'), img('b'), img('c')];
    expect(selectImages(skeleton, new Set(['a', 'b', 'c']), 2).selected).toEqual(['a', 'b']);
  });

  it('ignores nodes that already carry an omission marker or are not images', () => {
    const text: SkeletonNode = { ...img('t'), image: undefined };
    const skeleton = [img('gone', { omitted: 'detector_failed' }), text, img('ok')];
    expect(selectImages(skeleton, new Set(['ok', 'gone', 't']), 5)).toEqual({ selected: ['ok'], overLimit: [], missing: [] });
  });

  it('reports a visible, unmarked image with no sendable result as missing (so it still gets a marker)', () => {
    expect(selectImages([img('lost')], new Set(), 3)).toEqual({ selected: [], overLimit: [], missing: ['lost'] });
  });

  it('does not report images inside hidden containers (§6.7: never queued, no marker)', () => {
    expect(selectImages([img('hidden', { visible: false })], new Set(), 3)).toEqual({ selected: [], overLimit: [], missing: [] });
  });

  it('a limit of 0 sends nothing', () => {
    expect(selectImages([img('a')], new Set(['a']), 0)).toEqual({ selected: [], overLimit: ['a'], missing: [] });
  });
});
