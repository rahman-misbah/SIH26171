// §14.3: turn this step's sendable (already redacted) images into the
// observation's `images`: select by backend.capabilities, re-encode to fit
// maxImageBytes, and write a marker on every image node that won't be sent
// (§2.10). The JPEG re-encoder is injected (it needs OffscreenCanvas), so
// this stays platform-free and unit-testable.

import { selectImages } from './selectImages';
import type { BackendCapabilities, ObservationImage } from '@/backend/types';
import type { ImageOmittedReason, SkeletonNode } from '@/dom/types';
import { fitImageBytes, type FitStep } from '@/image/fitBytes';

export interface AvailableImage {
  img_id: string;
  blob: Blob; // redacted JPEG
}

export interface PreparedImages {
  skeleton: SkeletonNode[]; // a copy, with markers added
  images: ObservationImage[];
}

export async function prepareObservationImages(
  skeleton: SkeletonNode[],
  available: ReadonlyMap<string, AvailableImage>,
  capabilities: BackendCapabilities,
  reencode: (redacted: Blob, step: FitStep) => Promise<Blob>,
): Promise<PreparedImages> {
  const selection = selectImages(skeleton, new Set(available.keys()), capabilities.maxImagesPerRequest);
  const marks = new Map<string, ImageOmittedReason>();
  for (const id of selection.overLimit) marks.set(id, 'request_limit');
  for (const id of selection.missing) marks.set(id, 'unreadable');

  const images: ObservationImage[] = [];
  for (const node_id of selection.selected) {
    const image = available.get(node_id);
    if (!image) continue; // selectImages only selects available nodes
    const fitted = await fitImageBytes(image.blob, capabilities.maxImageBytes, (step) => reencode(image.blob, step));
    if (!fitted) {
      marks.set(node_id, 'request_limit'); // too large even at the smallest step (decided in the M9 plan)
      continue;
    }
    images.push({ img_id: image.img_id, node_id, mime: 'image/jpeg', data: new Uint8Array(await fitted.arrayBuffer()) });
  }

  return {
    skeleton: skeleton.map((node) => {
      const mark = marks.get(node.node_id);
      return mark ? { ...node, image_omitted: mark } : node;
    }),
    images,
  };
}
