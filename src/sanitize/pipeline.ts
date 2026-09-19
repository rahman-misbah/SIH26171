// §5.2/§7: per-ContentUnit dispatcher the compute host runs for each chunk.
// href/src carry URLs (§7.8); everything else is plain text (§7.1-7.4).

import { sanitizeText, type SanitizeTextContext } from './sanitizeText';
import { sanitizeUrl } from './url';
import type { ContentUnit } from '@/dom/types';
import type { TokenMapImpl } from './tokenMap';

export interface PipelineContext {
  origin: string;
  tokenMap: TokenMapImpl;
}

export async function sanitizeUnit(unit: ContentUnit, ctx: PipelineContext): Promise<string> {
  const textCtx: SanitizeTextContext = {
    origin: ctx.origin,
    tokenMap: ctx.tokenMap,
    node_id: unit.node_id,
    field: unit.field,
  };
  if (unit.field === 'href' || unit.field === 'src') return sanitizeUrl(unit.text, textCtx);
  return sanitizeText(unit.text, textCtx);
}
