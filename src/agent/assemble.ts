// §14: Sanitized observation assembly. Platform-free (no `browser`/`chrome`,
// no logging) so it can be called from wherever owns sessions -- the
// compute host's dispatch table for M5's observe-only path, and
// src/agent/loop.ts (M6) for real agent-loop steps, which passes `history`.
// `images` are already redacted, selected and sized (prepareImages.ts, M9);
// their nodes' omission markers are already on `skeleton`.

import { mergeWindows } from '@/dom/contentUnits';
import type { ContentField, SanitizedNode, SkeletonNode } from '@/dom/types';
import { matchRegexSpans } from '@/sanitize/regex';
import type { ObservationImage, SanitizedObservation } from '@/backend/types';

export interface ContentResult {
  node_id: string;
  field: ContentField;
  text: string;
}

export interface AssembleInput {
  session_id: string;
  step: number;
  task: string; // already sanitized
  page: { url: string; title: string; viewport: { w: number; h: number }; scroll: { x: number; y: number } }; // already sanitized
  skeleton: SkeletonNode[];
  contentResults: ContentResult[]; // already sanitized, original window order preserved
  // §13.2: previous steps' thought/actions/results, already sanitized (tokens
  // only, never raw PII, since they're the same Action objects the backend
  // itself returned). Owned by the agent loop (M6) -- empty for a standalone
  // assemble call (M5's observe-only path, e2e ping test).
  history?: SanitizedObservation['history'];
  // §14.3: from prepareObservationImages(). Omitted -> no images.
  images?: ObservationImage[];
}

export type AssembleResult = { status: 'ok'; observation: SanitizedObservation } | { status: 'blocked' };

function groupResults(results: ContentResult[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const result of results) {
    const key = `${result.node_id} ${result.field}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(result.text);
    else groups.set(key, [result.text]);
  }
  return groups;
}

function buildContent(node: SkeletonNode, groups: Map<string, string[]>): Partial<Record<ContentField, string>> {
  const content: Partial<Record<ContentField, string>> = {};

  // §5.1: secret fields' value is never read, anywhere in the pipeline --
  // hardcoded here rather than round-tripped through sanitization.
  if (node.secret) content.value = '[SECRET]';

  for (const field of node.pending_content) {
    if (field === 'value' && node.secret) continue;
    const texts = groups.get(`${node.node_id} ${field}`);
    if (!texts) continue;
    content[field] = field === 'text' && texts.length > 1 ? mergeWindows(texts) : (texts[0] ?? '');
  }

  return content;
}

function buildDom(skeleton: SkeletonNode[], results: ContentResult[]): SanitizedNode[] {
  const groups = groupResults(results);
  return skeleton.map((node) => {
    const { pending_content, ...rest } = node;
    void pending_content;
    return { ...rest, content: buildContent(node, groups) };
  });
}

// §14.5: defence-in-depth regex rescan of the observation's *content*
// strings -- task, page url/title, and each dom node's sanitized content
// values. Deliberately narrower than JSON.stringify-ing the whole object:
// opaque structural identifiers (session_id, node_id, unit ids) are random
// and can coincidentally satisfy a Tier-1 regex + checksum by chance (a
// UUID's hex/hyphen run occasionally passes the Luhn/Verhoeff check), which
// would false-trigger the guard on data that was never PII in the first
// place.
//
// EMAIL matches are excluded from this rescan (M7, §7.5): a public-contact
// email is *deliberately* left untokenized by sanitizeText.ts, using node
// context (page origin, landmark/heading/markup/UGC hints) that no longer
// exists at this stage -- content is just plain strings by the time
// assembleObservation runs, so this guard can't re-derive that decision, and
// re-running the heuristic with less information than the original decision
// had isn't a safety net, it's a coin flip. Every other PII type has no such
// exemption and should never legitimately survive to this stage, so a real
// hit for any of them still aborts the step (fail-closed, and in practice a
// sign of a pipeline bug).
function collectContentStrings(observation: SanitizedObservation): string[] {
  const strings = [observation.task, observation.page.url, observation.page.title];
  for (const node of observation.dom) {
    for (const value of Object.values(node.content)) {
      if (typeof value === 'string') strings.push(value);
    }
  }
  return strings;
}

function finalGuardTriggered(observation: SanitizedObservation): boolean {
  return collectContentStrings(observation).some((text) =>
    matchRegexSpans(text).some((span) => span.type !== 'EMAIL'),
  );
}

export function assembleObservation(input: AssembleInput): AssembleResult {
  const observation: SanitizedObservation = {
    schema_version: '1',
    session_id: input.session_id,
    step: input.step,
    task: input.task,
    page: input.page,
    dom: buildDom(input.skeleton, input.contentResults),
    images: input.images ?? [],
    history: input.history ?? [],
  };

  if (finalGuardTriggered(observation)) return { status: 'blocked' };
  return { status: 'ok', observation };
}
