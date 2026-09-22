// §12.2: SanitizedObservation -> ModelRequest. Vendor-agnostic -- the same
// shape is sent to every LlmAgentBackend-backed provider; vendor-specific
// request encoding happens only in src/backend/llm/clients/ (§12.5).

import type { ImageContent, ModelRequest, TextContent } from './types';
import type { SanitizedObservation } from '@/backend/types';

export function buildModelRequest(observation: SanitizedObservation, systemPrompt: string): ModelRequest {
  const { images, ...rest } = observation;
  const image_index = Object.fromEntries(images.map((img) => [img.img_id, img.node_id]));

  const items: (TextContent | ImageContent)[] = [{ kind: 'text', text: JSON.stringify({ ...rest, image_index }) }];
  for (const img of images) items.push({ kind: 'image', mime: img.mime, data: img.data });

  return { system: systemPrompt, items, wantJson: true };
}
