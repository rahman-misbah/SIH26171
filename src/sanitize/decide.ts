// §7.4: a span is PII if it's a regex match, or an NER span of any
// confidence bucket (§7.3: no Tier-3 disambiguation, low/medium buckets are
// redacted same as high), unless the public-contact heuristic (§7.5) marks
// an EMAIL span public.
//
// NER spans arrive with `label` already normalized to a PiiType-shaped
// string by the active provider's own label map (§7.2/§9.3: "providers own
// ... label maps" -- only a provider file may know a specific model's raw
// label vocabulary). This module just trusts that normalization, with a
// runtime guard: an unrecognized label still counts as PII (fail-closed),
// typed OTHER, exactly like an unmapped provider label would.

import { isPublicEmail } from './emailHeuristic';
import type { Bucket } from '@/models/capabilities';
import type { ContextHints } from '@/dom/types';
import type { RegexSpan } from './regex';
import { PII_TYPES, type PiiType } from './types';

export interface NerSpan {
  start: number;
  end: number;
  label: string;
  confidence: Bucket;
}

export interface PiiSpan {
  type: PiiType;
  start: number;
  end: number;
}

export interface DecidePiiContext {
  pageOrigin: string;
  hints: ContextHints | undefined;
  isMailtoHref: boolean;
}

function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

function isPiiType(label: string): label is PiiType {
  return (PII_TYPES as readonly string[]).includes(label);
}

export function decidePii(text: string, regexSpans: RegexSpan[], nerSpans: NerSpan[], ctx: DecidePiiContext): PiiSpan[] {
  const spans: PiiSpan[] = regexSpans.map((s) => ({ type: s.type, start: s.start, end: s.end }));

  for (const ner of nerSpans) {
    if (spans.some((s) => overlaps([s.start, s.end], [ner.start, ner.end]))) continue;
    spans.push({ type: isPiiType(ner.label) ? ner.label : 'OTHER', start: ner.start, end: ner.end });
  }

  const kept = spans.filter((span) => {
    if (span.type !== 'EMAIL') return true;
    const email = text.slice(span.start, span.end);
    return !isPublicEmail({ email, pageOrigin: ctx.pageOrigin, hints: ctx.hints, isMailtoHref: ctx.isMailtoHref });
  });

  return kept.sort((a, b) => a.start - b.start);
}
