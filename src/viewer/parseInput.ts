// Demo tooling (M12): turns "what was sent to the backend" into observations
// the viewer page (src/entrypoints/viewer/) can render. Accepts what a
// presenter can actually get hold of:
//   - an OpenAI-style chat/completions request body, copied from the compute
//     host's DevTools Network tab (src/backend/llm/serialize.ts +
//     clients/openaiCompatible.ts: the observation JSON is the first text
//     part, then one image_url part per image, in `image_index` order);
//   - a HAR file exported from that Network tab (every step at once);
//   - a raw SanitizedObservation as the wire protocol sends it
//     (docs/WIRE_PROTOCOL.md: images with base64 `data`).
// Pure: no DOM, no network. Everything it reads is already sanitized.

import type { SanitizedNode } from '@/dom/types';

export interface ViewImage {
  img_id: string;
  node_id: string;
  src: string; // data: URL of the redacted image exactly as sent
}

export interface ViewObservation {
  step: number;
  task: string;
  page: { url: string; title: string };
  truncated: boolean;
  dom: SanitizedNode[];
  images: ViewImage[];
  history: { step: number; thought: string }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function looksLikeObservation(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Array.isArray(value.dom) && typeof value.task === 'string';
}

// The fields every format shares. `dom` is trusted to be SanitizedNode[] in
// shape only as far as the renderer reads it (it guards each field it uses).
function baseObservation(obs: Record<string, unknown>, images: ViewImage[]): ViewObservation {
  const page = isRecord(obs.page) ? obs.page : {};
  const history = Array.isArray(obs.history) ? obs.history.filter(isRecord) : [];
  return {
    step: typeof obs.step === 'number' ? obs.step : 0,
    task: str(obs.task),
    page: { url: str(page.url), title: str(page.title) },
    truncated: obs.truncated === true,
    dom: (obs.dom as unknown[]).filter(isRecord) as unknown as SanitizedNode[],
    images,
    history: history.map((h) => ({ step: typeof h.step === 'number' ? h.step : 0, thought: str(h.thought) })),
  };
}

// Wire format: images carry base64 `data` (docs/WIRE_PROTOCOL.md).
function fromWire(obs: Record<string, unknown>): ViewObservation {
  const images = (Array.isArray(obs.images) ? obs.images : []).filter(isRecord).flatMap((img): ViewImage[] => {
    const data = str(img.data);
    if (!data) return [];
    return [{ img_id: str(img.img_id), node_id: str(img.node_id), src: `data:${str(img.mime) || 'image/jpeg'};base64,${data}` }];
  });
  return baseObservation(obs, images);
}

// Chat/completions body: the user message's first text part is the
// observation (minus images, plus `image_index` img_id -> node_id); the
// image_url parts follow in the same order as `image_index`'s keys.
function fromChatBody(body: Record<string, unknown>): ViewObservation | undefined {
  const messages = Array.isArray(body.messages) ? body.messages.filter(isRecord) : [];
  const user = messages.find((m) => m.role === 'user');
  if (!user) return undefined;
  const parts = typeof user.content === 'string' ? [{ type: 'text', text: user.content }] : Array.isArray(user.content) ? user.content.filter(isRecord) : [];

  const text = parts.find((p) => p.type === 'text');
  if (!text) return undefined;
  let obs: unknown;
  try {
    obs = JSON.parse(str(text.text));
  } catch {
    return undefined;
  }
  if (!looksLikeObservation(obs)) return undefined;

  const urls = parts.filter((p) => p.type === 'image_url').map((p) => (isRecord(p.image_url) ? str(p.image_url.url) : ''));
  const index = isRecord(obs.image_index) ? Object.entries(obs.image_index) : [];
  const images = index.flatMap(([img_id, node_id], i): ViewImage[] => {
    const src = urls[i];
    return src ? [{ img_id, node_id: str(node_id), src }] : [];
  });
  return baseObservation(obs, images);
}

function fromAny(value: unknown): ViewObservation | undefined {
  if (!isRecord(value)) return undefined;
  if (Array.isArray(value.messages)) return fromChatBody(value);
  if (looksLikeObservation(value)) return fromWire(value);
  return undefined;
}

// HAR: every request whose body is one of the formats above, in order.
function fromHar(har: Record<string, unknown>): ViewObservation[] {
  const log = isRecord(har.log) ? har.log : {};
  const entries = Array.isArray(log.entries) ? log.entries.filter(isRecord) : [];
  return entries.flatMap((entry) => {
    const request = isRecord(entry.request) ? entry.request : {};
    const postData = isRecord(request.postData) ? request.postData : {};
    const body = str(postData.text);
    if (!body) return [];
    try {
      const obs = fromAny(JSON.parse(body));
      return obs ? [obs] : [];
    } catch {
      return [];
    }
  });
}

export function parseInput(raw: string): ViewObservation[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('That isn’t valid JSON. Copy the whole request body, or drop a .har file.');
  }
  if (isRecord(value) && isRecord(value.log)) {
    const steps = fromHar(value);
    if (steps.length === 0) throw new Error('No Edward requests found in this HAR file.');
    return steps;
  }
  const obs = fromAny(value);
  if (!obs) throw new Error('This doesn’t look like an Edward request: expected a chat/completions body, a HAR file or a SanitizedObservation.');
  return [obs];
}
