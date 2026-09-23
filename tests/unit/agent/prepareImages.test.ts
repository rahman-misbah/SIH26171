// §14.3: selected images -> ObservationImage[] (re-encoded to fit
// maxImageBytes), and markers on every image node that won't be sent.
// Written before the implementation.

import { describe, expect, it, vi } from 'vitest';
import { prepareObservationImages } from '@/agent/prepareImages';
import type { BackendCapabilities } from '@/backend/types';
import type { SkeletonNode } from '@/dom/types';

function img(node_id: string, area = 100): SkeletonNode {
  return {
    node_id,
    tag: 'img',
    node_type: 'element',
    parent_id: null,
    bbox: { x: 0, y: 0, w: area, h: 1 },
    visible: true,
    in_viewport: true,
    image: 'img',
    pending_content: [],
  };
}

const jpeg = (bytes: number[]) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
const caps = (maxImagesPerRequest: number, maxImageBytes = 1000): BackendCapabilities => ({ maxImagesPerRequest, maxImageBytes, maxContextTokens: 1000 });

describe('prepareObservationImages', () => {
  it('returns the selected images in send order with their bytes, and leaves their nodes unmarked', async () => {
    const skeleton = [img('small', 10), img('big', 500)];
    const available = new Map([
      ['small', { img_id: 'i-small', blob: jpeg([1]) }],
      ['big', { img_id: 'i-big', blob: jpeg([2, 2]) }],
    ]);
    const out = await prepareObservationImages(skeleton, available, caps(2), vi.fn());
    expect(out.images.map((i) => [i.node_id, i.img_id, i.mime, [...i.data]])).toEqual([
      ['big', 'i-big', 'image/jpeg', [2, 2]],
      ['small', 'i-small', 'image/jpeg', [1]],
    ]);
    expect(out.skeleton.every((n) => n.image_omitted === undefined)).toBe(true);
  });

  it('marks images beyond maxImagesPerRequest as request_limit', async () => {
    const skeleton = [img('a', 300), img('b', 200), img('c', 100)];
    const available = new Map(skeleton.map((n) => [n.node_id, { img_id: n.node_id, blob: jpeg([1]) }]));
    const out = await prepareObservationImages(skeleton, available, caps(1), vi.fn());
    expect(out.images.map((i) => i.node_id)).toEqual(['a']);
    expect(out.skeleton.map((n) => n.image_omitted)).toEqual([undefined, 'request_limit', 'request_limit']);
  });

  it('re-encodes an image over maxImageBytes, and withholds it as request_limit if nothing fits', async () => {
    const skeleton = [img('fits'), img('never')];
    const available = new Map([
      ['fits', { img_id: 'f', blob: jpeg(new Array(50).fill(1)) }],
      ['never', { img_id: 'n', blob: jpeg(new Array(60).fill(1)) }],
    ]);
    const reencode = vi.fn(async (blob: Blob) => (blob.size === 50 ? jpeg([7]) : jpeg(new Array(40).fill(1))));
    const out = await prepareObservationImages(skeleton, available, caps(5, 10), reencode);
    expect(out.images.map((i) => [i.node_id, [...i.data]])).toEqual([['fits', [7]]]);
    expect(out.skeleton.find((n) => n.node_id === 'never')?.image_omitted).toBe('request_limit');
  });

  it('marks a visible image with no sendable result as unreadable (every exclusion leaves a marker)', async () => {
    const out = await prepareObservationImages([img('lost')], new Map(), caps(3), vi.fn());
    expect(out.skeleton[0]?.image_omitted).toBe('unreadable');
    expect(out.images).toEqual([]);
  });

  it('does not mutate the caller\'s skeleton nodes', async () => {
    const skeleton = [img('a'), img('b')];
    await prepareObservationImages(skeleton, new Map([['a', { img_id: 'a', blob: jpeg([1]) }]]), caps(0), vi.fn());
    expect(skeleton.every((n) => n.image_omitted === undefined)).toBe(true);
  });
});
