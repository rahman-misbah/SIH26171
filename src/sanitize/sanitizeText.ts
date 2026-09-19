// §7: the shared regex -> NER -> decide -> tokenize path for one piece of
// text, from either DOM content (§7) or a URL segment/query value (§7.8).

import { decidePii } from './decide';
import { passthroughNer } from './ner';
import { matchRegexSpans } from './regex';
import type { TokenMapImpl } from './tokenMap';
import type { PiiType } from './types';

export interface SanitizeTextContext {
  origin: string;
  tokenMap: TokenMapImpl;
  node_id: string;
  field: string;
}

export async function sanitizeText(text: string, ctx: SanitizeTextContext): Promise<string> {
  const regexSpans = matchRegexSpans(text);
  const [nerSpans = []] = await passthroughNer.tag([text]);
  const spans = decidePii(regexSpans, nerSpans);
  if (spans.length === 0) return text;

  let out = '';
  let cursor = 0;
  for (const span of spans) {
    out += text.slice(cursor, span.start);
    const value = text.slice(span.start, span.end);
    out += ctx.tokenMap.tokenize({
      type: span.type,
      value,
      origin: ctx.origin,
      source: { node_id: ctx.node_id, field: ctx.field, offset: span.start },
    });
    cursor = span.end;
  }
  out += text.slice(cursor);
  return out;
}

// §7.8: redact a query value unconditionally (sensitive key), still through
// the token map so the agent gets a stable, labelled placeholder.
export function tokenizeOpaque(value: string, type: PiiType, ctx: SanitizeTextContext): string {
  return ctx.tokenMap.tokenize({
    type,
    value,
    origin: ctx.origin,
    source: { node_id: ctx.node_id, field: ctx.field, offset: 0 },
  });
}
