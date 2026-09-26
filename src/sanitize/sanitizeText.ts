// §7: the shared regex -> NER -> decide -> tokenize path for one piece of
// text, from either DOM content (§7) or a URL segment/query value (§7.8).
// §7.7: a per-session memo is checked first; a hit skips regex and NER
// entirely and is logged as `sanitize.memo_hit`.

import { findKnownValues } from './knownValues';
import { tagMasked } from './maskRegex';
import { decidePii } from './decide';
import { matchRegexSpans } from './regex';
import type { TokenMapImpl } from './tokenMap';
import type { PiiType } from './types';
import type { ContextHints } from '@/dom/types';
import type { LogRecord } from '@/logging';
import type { PiiNer } from '@/models/capabilities';
import type { SanitizeMemo } from './memo';

// Only the write path this module needs -- lets tests pass a bare object
// instead of a full RuntimeLogger.
export interface MemoHitLogger {
  record(record: LogRecord): void;
}

export interface SanitizeTextContext {
  origin: string;
  tokenMap: TokenMapImpl;
  memo: SanitizeMemo;
  ner: PiiNer;
  logger: MemoHitLogger;
  session_id: string;
  node_id: string;
  field: string;
  context?: ContextHints;
  isMailtoHref: boolean;
}

export async function sanitizeText(text: string, ctx: SanitizeTextContext): Promise<string> {
  const t_start = performance.timeOrigin + performance.now();
  // M12: values this session already tokenized on this origin (§7.6). A
  // text containing one skips the memo: the memoized result may predate the
  // value becoming known, and would then send it in the clear.
  const knownSpans = findKnownValues(text, ctx.tokenMap.knownValues(ctx.origin));
  const memoHit = knownSpans.length > 0 ? undefined : await ctx.memo.lookup(ctx.origin, text, ctx.context);
  if (memoHit !== undefined) {
    const t_end = performance.timeOrigin + performance.now();
    ctx.logger.record({
      session_id: ctx.session_id,
      op: 'sanitize.memo_hit',
      t_start,
      t_end,
      duration_ms: t_end - t_start,
      outcome: 'ok',
      ref: ctx.node_id,
    });
    return memoHit;
  }

  // Known values are masked for NER like regex spans, and bypass the §7.5
  // public-email check: a value tokenized once stays tokenized everywhere.
  const overlapsKnown = (s: { start: number; end: number }) => knownSpans.some((k) => s.start < k.end && k.start < s.end);
  const regexSpans = matchRegexSpans(text).filter((s) => !overlapsKnown(s));
  const [nerSpans = []] = await tagMasked(ctx.ner, [text], [[...knownSpans, ...regexSpans]]);
  const decided = decidePii(text, regexSpans, nerSpans, {
    pageOrigin: ctx.origin,
    hints: ctx.context,
    isMailtoHref: ctx.isMailtoHref,
  });
  const spans = [...knownSpans, ...decided].sort((a, b) => a.start - b.start);

  let out: string;
  if (spans.length === 0) {
    out = text;
  } else {
    out = '';
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
  }

  await ctx.memo.store(ctx.origin, text, ctx.context, out);
  return out;
}

// §7.8: redact a query value unconditionally (sensitive key), still through
// the token map so the agent gets a stable, labelled placeholder. Not
// memoized (§7.7 is a regex+NER skip; there's no detection work to skip here).
export function tokenizeOpaque(value: string, type: PiiType, ctx: SanitizeTextContext): string {
  return ctx.tokenMap.tokenize({
    type,
    value,
    origin: ctx.origin,
    source: { node_id: ctx.node_id, field: ctx.field, offset: 0 },
  });
}
