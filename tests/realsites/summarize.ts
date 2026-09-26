// M12: reduces one observation from the e2e hook (`data-edward-observation`)
// to counts, in the Playwright process. The raw JSON is never written
// anywhere: on a real site it holds real people's (sanitized) page text.

import { scanResidualPii } from '../../src/sanitize/residualScan';
import type { ObservationSummary, SiteOutcome } from '../../scripts/realSitesTable.ts';

interface HookNode {
  content?: Record<string, unknown>;
  marker?: string;
  image?: string;
  image_omitted?: string;
}

const TOKEN_RE = /\[PII_([A-Z]+(?:_[A-Z]+)*)_(\d+)\]/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function bump(record: Record<string, number>, key: string, by = 1): void {
  record[key] = (record[key] ?? 0) + by;
}

export function summarizeObservation(raw: string, pageOrigin: string): { outcome: SiteOutcome; summary?: ObservationSummary } {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) return { outcome: 'error' };
  if (parsed.status === 'blocked') return { outcome: 'blocked' };
  if (parsed.status !== 'ok' || !isRecord(parsed.observation)) return { outcome: 'error' };
  const observation = parsed.observation;

  const dom = Array.isArray(observation.dom) ? (observation.dom as HookNode[]) : [];
  const markers: Record<string, number> = {};
  const omitted: Record<string, number> = {};
  let contentFields = 0;
  let imageNodes = 0;
  for (const node of dom) {
    if (node.marker) bump(markers, node.marker);
    if (node.image) imageNodes += 1;
    if (node.image_omitted) bump(omitted, node.image_omitted);
    contentFields += Object.keys(node.content ?? {}).length;
  }

  // Distinct tokens: the same value repeated on a page reuses one token (§7.6).
  const seen = new Set<string>();
  const tokens: Record<string, number> = {};
  for (const match of raw.matchAll(TOKEN_RE)) {
    if (seen.has(match[0])) continue;
    seen.add(match[0]);
    bump(tokens, match[1] ?? 'OTHER');
  }

  const images = Array.isArray(observation.images) ? observation.images : [];
  const residual = scanResidualPii(observation, pageOrigin).hits;
  return {
    outcome: 'ok',
    summary: {
      nodes: dom.length,
      content_fields: contentFields,
      tokens,
      markers,
      image_nodes: imageNodes,
      images_sent: images.length,
      images_omitted: omitted,
      // The observation's JSON without images: what counts against a
      // backend's context. Images are counted apart, from the hook's base64
      // (~4/3 of the bytes a backend gets).
      text_kb: Math.round(JSON.stringify({ ...observation, images: [] }).length / 1024),
      images_kb: Math.round((raw.length - JSON.stringify({ ...parsed, observation: { ...observation, images: [] } }).length) / 1024),
      truncated: observation.truncated === true,
      trimmed_nodes: dom.filter((n) => (n as { trimmed?: boolean }).trimmed === true).length,
      residual: residual as Record<string, number>,
    },
  };
}
