// §5.2/§7: per-ContentUnit dispatcher the compute host runs for each chunk.
// href/src carry URLs (§7.8); everything else is plain text (§7.1-7.4).

import type { MemoHitLogger } from './sanitizeText';
import { sanitizeText, type SanitizeTextContext } from './sanitizeText';
import { sanitizeUrl } from './url';
import type { ContentUnit } from '@/dom/types';
import type { PiiNer } from '@/models/capabilities';
import type { SanitizeMemo } from './memo';
import type { TokenMapImpl } from './tokenMap';

export interface PipelineContext {
  origin: string;
  tokenMap: TokenMapImpl;
  memo: SanitizeMemo;
  ner: PiiNer;
  logger: MemoHitLogger;
  session_id: string;
}

export async function sanitizeUnit(unit: ContentUnit, ctx: PipelineContext): Promise<string> {
  const isMailtoHref = unit.field === 'href' && unit.text.startsWith('mailto:');
  const textCtx: SanitizeTextContext = {
    origin: ctx.origin,
    tokenMap: ctx.tokenMap,
    memo: ctx.memo,
    ner: ctx.ner,
    logger: ctx.logger,
    session_id: ctx.session_id,
    node_id: unit.node_id,
    field: unit.field,
    context: unit.context,
    isMailtoHref,
  };
  if (unit.field === 'href' || unit.field === 'src') return sanitizeUrl(unit.text, textCtx);
  return sanitizeText(unit.text, textCtx);
}
