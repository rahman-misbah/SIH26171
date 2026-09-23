// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import {
  classifyImageNode,
  collectImageCandidates,
  extractCssUrl,
  MIN_IMAGE_SIDE_PX,
  orderCandidates,
} from '@/dom/imageCandidates';
import { ElementRegistry } from '@/dom/registry';
import type { SkeletonNode } from '@/dom/types';

function imageNode(overrides: Partial<SkeletonNode> = {}): SkeletonNode {
  return {
    node_id: 'n1',
    tag: 'img',
    node_type: 'element',
    parent_id: null,
    bbox: { x: 0, y: 0, w: 200, h: 200 },
    visible: true,
    in_viewport: true,
    image: 'img',
    pending_content: [],
    ...overrides,
  };
}

describe('classifyImageNode (§6.1 size floor, §6.7 prioritization)', () => {
  const VH = 800;

  it('uses a 32px size floor', () => {
    expect(MIN_IMAGE_SIDE_PX).toBe(32);
  });

  it('skips nodes that carry no image', () => {
    expect(classifyImageNode(imageNode({ image: undefined }), VH)).toEqual({ kind: 'skip' });
  });

  it('does not queue images in visible:false containers, and gives them no marker', () => {
    expect(classifyImageNode(imageNode({ visible: false }), VH)).toEqual({ kind: 'skip' });
  });

  it('marks images rendered smaller than 32x32 as too_small', () => {
    expect(classifyImageNode(imageNode({ bbox: { x: 0, y: 0, w: 31, h: 200 } }), VH)).toEqual({ kind: 'too_small' });
    expect(classifyImageNode(imageNode({ bbox: { x: 0, y: 0, w: 200, h: 16 } }), VH)).toEqual({ kind: 'too_small' });
  });

  it('keeps an image exactly at the floor', () => {
    expect(classifyImageNode(imageNode({ bbox: { x: 0, y: 0, w: 32, h: 32 } }), VH).kind).toBe('queue');
  });

  it('gives in-viewport images priority 0', () => {
    expect(classifyImageNode(imageNode(), VH)).toEqual({ kind: 'queue', priority: 0, area: 40_000 });
  });

  it('gives images within one viewport height of the viewport priority 1', () => {
    const below = imageNode({ in_viewport: false, bbox: { x: 0, y: VH + 100, w: 100, h: 100 } });
    const above = imageNode({ in_viewport: false, bbox: { x: 0, y: -VH + 50, w: 100, h: 100 } });
    expect(classifyImageNode(below, VH)).toMatchObject({ priority: 1 });
    expect(classifyImageNode(above, VH)).toMatchObject({ priority: 1 });
  });

  it('gives everything further away priority 2', () => {
    const far = imageNode({ in_viewport: false, bbox: { x: 0, y: 3 * VH, w: 100, h: 100 } });
    expect(classifyImageNode(far, VH)).toMatchObject({ priority: 2 });
  });
});

describe('orderCandidates (§6.7)', () => {
  it('orders by priority, then by larger area first', () => {
    const ordered = orderCandidates([
      { id: 'far-big', priority: 2 as const, area: 1_000_000 },
      { id: 'view-small', priority: 0 as const, area: 100 },
      { id: 'near', priority: 1 as const, area: 500 },
      { id: 'view-big', priority: 0 as const, area: 9_000 },
    ]);
    expect(ordered.map((c) => c.id)).toEqual(['view-big', 'view-small', 'near', 'far-big']);
  });
});

describe('extractCssUrl (§6.1: url(...) only, gradients ignored)', () => {
  it('extracts a quoted or unquoted url', () => {
    expect(extractCssUrl('url("https://example.com/a.png")')).toBe('https://example.com/a.png');
    expect(extractCssUrl("url('b.png')")).toBe('b.png');
    expect(extractCssUrl('url(c.png)')).toBe('c.png');
  });

  it('takes the first url among layered backgrounds', () => {
    expect(extractCssUrl('linear-gradient(red, blue), url("d.png"), url("e.png")')).toBe('d.png');
  });

  it('ignores gradients and none', () => {
    expect(extractCssUrl('linear-gradient(red, blue)')).toBeUndefined();
    expect(extractCssUrl('none')).toBeUndefined();
    expect(extractCssUrl('')).toBeUndefined();
  });
});

describe('collectImageCandidates', () => {
  it('reads <img> sources and background-image urls, and marks too-small images on the skeleton', () => {
    document.body.innerHTML = `
      <img id="big" src="https://example.com/big.png">
      <img id="tiny" src="https://example.com/tiny.png">
      <div id="bg" style="background-image: url('https://example.com/bg.png')"></div>
    `;
    const registry = new ElementRegistry();
    registry.register('n1', document.getElementById('big')!);
    registry.register('n2', document.getElementById('tiny')!);
    registry.register('n3', document.getElementById('bg')!);
    const skeleton = [
      imageNode({ node_id: 'n1' }),
      imageNode({ node_id: 'n2', bbox: { x: 0, y: 0, w: 16, h: 16 } }),
      imageNode({ node_id: 'n3', tag: 'div', image: 'background', bbox: { x: 0, y: 0, w: 300, h: 300 } }),
    ];

    const candidates = collectImageCandidates(skeleton, registry, document);

    expect(candidates.map((c) => [c.node_id, c.src, c.kind])).toEqual([
      ['n3', 'https://example.com/bg.png', 'background'],
      ['n1', 'https://example.com/big.png', 'img'],
    ]);
    expect(skeleton[1]?.image_omitted).toBe('too_small');
  });

  it('marks an <img> with no source at all as unreadable', () => {
    document.body.innerHTML = '<img id="empty">';
    const registry = new ElementRegistry();
    registry.register('n1', document.getElementById('empty')!);
    const skeleton = [imageNode({ node_id: 'n1' })];

    expect(collectImageCandidates(skeleton, registry, document)).toEqual([]);
    expect(skeleton[0]?.image_omitted).toBe('unreadable');
  });

  it('marks an image whose element is gone from the registry as unreadable', () => {
    const skeleton = [imageNode({ node_id: 'gone' })];
    expect(collectImageCandidates(skeleton, new ElementRegistry(), document)).toEqual([]);
    expect(skeleton[0]?.image_omitted).toBe('unreadable');
  });
});
