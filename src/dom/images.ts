// §6 (content-script half): image candidates -> one imageLookup -> for each
// image the cache couldn't answer, a canvas read (§6.2.1) + imageProcess,
// in §6.7 priority order. Every image that won't be sent gets its
// `image_omitted` reason written onto its skeleton node (§2.10), so the
// assembler never has to know how that was decided.

import { collectImageCandidates, type ImageCandidate } from './imageCandidates';
import { loadBackgroundImage, readPixels } from './readPixels';
import type { ElementRegistry } from './registry';
import type { SkeletonNode } from './types';
import type { ImageOutcome } from '@/image/types';
import type { ImageRef } from '@/image/pipeline';
import type { LogRecord } from '@/logging/schema';
import type { Transport } from '@/platform/types';

// At most this many images in flight to the compute host at once. Matches
// the vision pool's upper bound (§9.6: N <= 3) -- more would only queue in
// the host while holding more pixel payloads in messaging.
const DISPATCH_CONCURRENCY = 3;

interface Resolved {
  candidate: ImageCandidate;
  img: HTMLImageElement | undefined;
  ref: ImageRef;
}

async function resolve(candidate: ImageCandidate): Promise<Resolved> {
  const img =
    candidate.kind === 'img'
      ? candidate.element instanceof HTMLImageElement
        ? candidate.element
        : undefined
      : await loadBackgroundImage(candidate.src);
  return {
    candidate,
    img,
    ref: {
      node_id: candidate.node_id,
      kind: candidate.kind,
      src: candidate.src,
      natural_w: img?.naturalWidth ?? 0,
      natural_h: img?.naturalHeight ?? 0,
    },
  };
}

// Runs `fn` over `items` with at most `limit` in flight, starting them in
// array order (which is the §6.7 priority order).
async function forEachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function lane(): Promise<void> {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

export interface ImageStepOptions {
  session_id: string;
  step: number;
  report: (record: LogRecord) => void;
}

export async function acquirePageImages(
  transport: Transport,
  doc: Document,
  skeleton: SkeletonNode[],
  registry: ElementRegistry,
  options: ImageStepOptions,
): Promise<void> {
  const { session_id, step, report } = options;
  const byId = new Map(skeleton.map((node) => [node.node_id, node]));

  function mark(node_id: string, outcome: ImageOutcome): void {
    const node = byId.get(node_id);
    if (node && outcome !== 'ok') node.image_omitted = outcome;
  }

  const candidates = collectImageCandidates(skeleton, registry, doc);

  // §6.1 size floor: logged as a skipped acquisition, so the metrics show how
  // many images the floor saved from processing (ref = opaque node_id only).
  for (const node of skeleton) {
    if (node.image_omitted !== 'too_small') continue;
    const t = performance.timeOrigin + performance.now();
    report({ session_id, step, op: 'image.acquire', t_start: t, t_end: t, duration_ms: 0, outcome: 'skipped', reason: 'too_small', ref: node.node_id });
  }

  if (candidates.length === 0) return;

  const resolved = await Promise.all(candidates.map(resolve));

  let lookups;
  try {
    ({ results: lookups } = await transport.request('imageLookup', { session_id, images: resolved.map((r) => r.ref) }));
  } catch {
    // Fail closed: nothing about these images could be checked.
    for (const r of resolved) mark(r.ref.node_id, 'unreadable');
    return;
  }

  const needPixels = new Set<string>();
  for (const result of lookups) {
    if (result.status === 'done') mark(result.node_id, result.outcome);
    else needPixels.add(result.node_id);
  }

  const toProcess = resolved.filter((r) => needPixels.has(r.ref.node_id));
  await forEachLimited(toProcess, DISPATCH_CONCURRENCY, async ({ img, ref }) => {
    const t_start = performance.timeOrigin + performance.now();
    const read = img ? await readPixels(img) : ({ ok: false, reason: 'unreadable' } as const);
    const t_end = performance.timeOrigin + performance.now();
    report({
      session_id,
      step,
      op: 'image.acquire',
      t_start,
      t_end,
      duration_ms: t_end - t_start,
      outcome: read.ok ? 'ok' : 'fail',
      reason: read.ok ? undefined : read.reason,
      ref: ref.node_id,
      counts: read.ok ? { bytes: read.png.byteLength } : undefined,
    });

    try {
      const result = await transport.request('imageProcess', { session_id, image: ref, pixels: read.ok ? read.png : undefined });
      mark(ref.node_id, result.outcome);
    } catch {
      mark(ref.node_id, 'unreadable');
    }
  });
}
