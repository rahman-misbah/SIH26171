// §14.3: which processed images go into the observation. Decided from
// `backend.capabilities.maxImagesPerRequest` only, never a backend name.
// Pure: the caller supplies which nodes have a sendable (already redacted)
// image and writes the resulting markers.

import type { SkeletonNode } from '@/dom/types';

export interface ImageSelection {
  selected: string[]; // node_ids, in send order
  overLimit: string[]; // -> image_omitted: 'request_limit'
  // Visible, unmarked image nodes with no sendable result -- shouldn't
  // happen, but if it does the node still needs a marker (§2.10).
  missing: string[];
}

export function selectImages(skeleton: SkeletonNode[], available: ReadonlySet<string>, maxImages: number): ImageSelection {
  const sendable: SkeletonNode[] = [];
  const missing: string[] = [];
  for (const node of skeleton) {
    if (!node.image || node.image_omitted) continue;
    if (available.has(node.node_id)) sendable.push(node);
    // §6.7: images in hidden containers are never queued and carry no marker.
    else if (node.visible) missing.push(node.node_id);
  }

  // In-viewport first, then larger rendered area. sort() is stable, so ties
  // keep DOM order.
  const ordered = [...sendable].sort(
    (a, b) => Number(b.in_viewport) - Number(a.in_viewport) || b.bbox.w * b.bbox.h - a.bbox.w * a.bbox.h,
  );
  const limit = Math.max(0, maxImages);
  return {
    selected: ordered.slice(0, limit).map((n) => n.node_id),
    overLimit: ordered.slice(limit).map((n) => n.node_id),
    missing,
  };
}
