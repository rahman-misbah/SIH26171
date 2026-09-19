// §7.4: a span is PII if it's a regex match, or an NER span of any
// confidence bucket (§7.3: no Tier-3 disambiguation, low/medium buckets are
// redacted same as high), unless the public-contact heuristic (§7.5) marks
// it public. That heuristic doesn't exist until M7, so this is currently a
// strict union -- correctly fail-closed (nothing is exempted as public yet).

import type { Bucket } from '@/models/capabilities';
import type { RegexSpan } from './regex';
import type { PiiType } from './types';

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

function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

export function decidePii(regexSpans: RegexSpan[], nerSpans: NerSpan[]): PiiSpan[] {
  const spans: PiiSpan[] = regexSpans.map((s) => ({ type: s.type, start: s.start, end: s.end }));

  for (const ner of nerSpans) {
    if (spans.some((s) => overlaps([s.start, s.end], [ner.start, ner.end]))) continue;
    // No provider label map exists until M7 (§7.2) -- unknown label -> PII, typed OTHER.
    spans.push({ type: 'OTHER', start: ner.start, end: ner.end });
  }

  return spans.sort((a, b) => a.start - b.start);
}
