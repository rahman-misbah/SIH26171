// §14.3: which processed images go into the observation. Decided from
// `backend.capabilities.maxImagesPerRequest` only, never a backend name.
// Pure: the caller supplies which nodes have a sendable (already redacted)
// image and writes the resulting markers.

import { classifyImageNode } from '@/dom/imageCandidates';
import type { SkeletonNode } from '@/dom/types';

export interface ImageSelection {
  selected: string[]; // node_ids, in send order
  overLimit: string[]; // -> image_omitted: 'request_limit'
  // Visible, unmarked image nodes with no sendable result -- shouldn't
  // happen, but if it does the node still needs a marker (§2.10).
  missing: string[];
}

// `viewportH` places off-viewport images in §6.7's near/far bands; without
// it every off-viewport image counts as near (area decides, as before M12).
export function selectImages(
  skeleton: SkeletonNode[],
  available: ReadonlySet<string>,
  maxImages: number,
  viewportH = Number.POSITIVE_INFINITY,
): ImageSelection {
  const sendable: SkeletonNode[] = [];
  const missing: string[] = [];
  for (const node of skeleton) {
    if (!node.image || node.image_omitted) continue;
    if (available.has(node.node_id)) sendable.push(node);
    // §6.7: images in hidden containers are never queued and carry no marker.
    else if (node.visible) missing.push(node.node_id);
  }

  // M12: the content script's §6.7 queue order (classifyImageNode), which
  // refines §14.3's "in-viewport first, then larger area" with the near-
  // viewport band. Using the same order on both sides makes the images sent
  // independent of which ones were cached (M10 Noticed 2). sort() is
  // stable, so ties keep DOM order.
  const rank = (node: SkeletonNode): [number, number] => {
    const cls = classifyImageNode(node, viewportH);
    return cls.kind === 'queue' ? [cls.priority, cls.area] : [3, node.bbox.w * node.bbox.h];
  };
  const ordered = [...sendable].sort((a, b) => {
    const [pa, areaA] = rank(a);
    const [pb, areaB] = rank(b);
    return pa - pb || areaB - areaA;
  });
  const limit = Math.max(0, maxImages);
  return {
    selected: ordered.slice(0, limit).map((n) => n.node_id),
    overLimit: ordered.slice(limit).map((n) => n.node_id),
    missing,
  };
}
