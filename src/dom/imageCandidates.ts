// §6.1 scope + size floor, §6.7 prioritization. Runs in the content script
// right after Phase A: turns image-bearing skeleton nodes into an ordered
// acquisition queue, and writes the markers that can be decided without any
// pixels (`too_small`, or `unreadable` when there is no source at all)
// straight onto the skeleton node (§2.10).

import type { ElementRegistry } from './registry';
import type { ImageKind, SkeletonNode } from './types';

// §6.1: images rendered smaller than 32x32 px are never sent -- too small to
// help the agent, and skipping them avoids avatars/icons that could contain
// faces (fail-closed and faster).
export const MIN_IMAGE_SIDE_PX = 32;

export type Priority = 0 | 1 | 2; // 0 = in viewport, 1 = near, 2 = the rest

export type ImageNodeClass = { kind: 'skip' } | { kind: 'too_small' } | { kind: 'queue'; priority: Priority; area: number };

export function classifyImageNode(node: SkeletonNode, viewportH: number): ImageNodeClass {
  if (!node.image) return { kind: 'skip' };
  // §6.7: images inside visible:false containers are not queued. No marker:
  // they're not an exclusion of visible content, and their surrounding text
  // is already capped (§14.2) -- decided with the user in the M8 plan.
  if (!node.visible) return { kind: 'skip' };
  const { x, y, w, h } = node.bbox;
  void x;
  if (w < MIN_IMAGE_SIDE_PX || h < MIN_IMAGE_SIDE_PX) return { kind: 'too_small' };
  const area = w * h;
  if (node.in_viewport) return { kind: 'queue', priority: 0, area };
  // §6.7 "near-viewport (within one viewport height)": overlaps the band
  // from one viewport height above the viewport to one below it.
  const near = y < 2 * viewportH && y + h > -viewportH;
  return { kind: 'queue', priority: near ? 1 : 2, area };
}

// §6.7: in-viewport first (largest area first), then near-viewport, then the
// rest. Array.prototype.sort is stable, so equal entries keep DOM order.
export function orderCandidates<T extends { priority: Priority; area: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.priority - b.priority || b.area - a.area);
}

// §6.1: `url(...)` only; gradients (and `none`) are ignored. Layered
// backgrounds contribute their first url() layer -- the one painted on top.
export function extractCssUrl(backgroundImage: string): string | undefined {
  const match = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/.exec(backgroundImage);
  const url = match?.[1] ?? match?.[2] ?? match?.[3];
  return url ? url : undefined;
}

export interface ImageCandidate {
  node_id: string;
  kind: ImageKind;
  src: string; // absolute URL (or data:/blob:) -- content; never leaves the device
  element: Element;
  priority: Priority;
  area: number;
}

function sourceOf(el: Element, kind: ImageKind, doc: Document): string | undefined {
  if (kind === 'img') {
    if (!(el instanceof HTMLImageElement)) return undefined;
    // §6.1: currentSrc covers srcset/<picture>; `src` (already absolute) is
    // the fallback before the browser has picked a candidate.
    const src = el.currentSrc || el.src;
    return src || undefined;
  }
  const raw = extractCssUrl(doc.defaultView?.getComputedStyle(el).backgroundImage ?? '');
  if (!raw) return undefined;
  try {
    return new URL(raw, doc.baseURI).href;
  } catch {
    return undefined;
  }
}

export function collectImageCandidates(skeleton: SkeletonNode[], registry: ElementRegistry, doc: Document): ImageCandidate[] {
  const viewportH = doc.defaultView?.innerHeight ?? 0;
  const candidates: ImageCandidate[] = [];

  for (const node of skeleton) {
    const cls = classifyImageNode(node, viewportH);
    if (cls.kind === 'skip') continue;
    if (cls.kind === 'too_small') {
      node.image_omitted = 'too_small';
      continue;
    }
    const kind = node.image;
    const element = registry.resolve(node.node_id);
    const src = element && kind ? sourceOf(element, kind, doc) : undefined;
    if (!element || !kind || !src) {
      // Nothing to acquire pixels from: withheld, never silently dropped.
      node.image_omitted = 'unreadable';
      continue;
    }
    candidates.push({ node_id: node.node_id, kind, src, element, priority: cls.priority, area: cls.area });
  }

  return orderCandidates(candidates);
}
