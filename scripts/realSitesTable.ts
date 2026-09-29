// M12 real-site pass (SPEC §18.1 on real pages): turns the per-site results
// written by tests/realsites/realSites.spec.ts into a markdown section of
// docs/REAL_SITES.md. Pure -- no I/O -- so it's unit tested
// (tests/unit/scripts/realSitesTable.test.ts). Counts and timings only: real
// pages hold real people's data, so no page text ever reaches this file.

import type { OpStats } from '../src/logging/aggregate.ts';
import type { DeviceProfile } from '../src/hw/types.ts';

export interface ObservationSummary {
  nodes: number;
  content_fields: number;
  // Distinct `[PII_<TYPE>_<n>]` tokens in the observation, by type.
  tokens: Record<string, number>;
  markers: Record<string, number>;
  image_nodes: number;
  images_sent: number;
  images_omitted: Record<string, number>;
  text_kb: number;
  images_kb: number;
  truncated: boolean; // §14.2 budget left content out (M12)
  trimmed_nodes: number;
  // tests/realsites: src/sanitize/residualScan.ts over the outgoing JSON.
  residual: Record<string, number>;
}

// 'nav_failed': the page never loaded; 'timeout': it loaded but no
// observation came back in time; 'error': the hook reported an exception;
// 'blocked': the §14 final guard withheld the whole observation (fail closed).
export type SiteOutcome = 'ok' | 'blocked' | 'error' | 'timeout' | 'nav_failed';

export interface SiteRun {
  id: string;
  category: string;
  url: string;
  outcome: SiteOutcome;
  observation_ms?: number;
  summary?: ObservationSummary;
  perOp: Record<string, OpStats>;
  failClosed: number;
  reasons: Record<string, number>;
}

export interface RealSitesRun {
  device: DeviceProfile;
  sites: SiteRun[];
}

const DASH = '–';

function ms(n: number | undefined): string {
  return n === undefined ? DASH : String(Math.round(n));
}

function sum(record: Record<string, number>): number {
  return Object.values(record).reduce((a, b) => a + b, 0);
}

// `{a: 2, b: 1}` -> "a 2, b 1"; empty -> "–".
function breakdown(record: Record<string, number>): string {
  const entries = Object.entries(record).filter(([, n]) => n > 0);
  if (entries.length === 0) return DASH;
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `${k} ${n}`)
    .join(', ');
}

function p50p95(stats: OpStats | undefined): string {
  return stats ? `${ms(stats.p50)} / ${ms(stats.p95)}` : DASH;
}

// Residual hits other than emails the heuristic may have kept public are
// leak candidates (src/sanitize/residualScan.ts).
export function leakCandidates(summary: ObservationSummary | undefined): number {
  if (!summary) return 0;
  return sum(Object.fromEntries(Object.entries(summary.residual).filter(([k]) => k !== 'EMAIL_LIKELY_PUBLIC')));
}

export function renderRealSitesSection(label: string, date: string, run: RealSitesRun): string {
  const { device, sites } = run;
  const lines: string[] = [`## ${label} — ${date}`, ''];
  lines.push(`${device.browser} · ${device.platform ?? 'platform n/a'} · ${device.hardwareConcurrency} logical cores · compute ${device.compute}`, '');

  lines.push('| site | kind | outcome | observe ms | nodes | fields | truncated (trimmed nodes) | tokens | markers | images sent / nodes | omitted | text KB | image KB | leak candidates |');
  lines.push('|---|---|---|---:|---:|---:|---|---|---|---:|---|---:|---:|---:|');
  for (const site of sites) {
    const s = site.summary;
    lines.push(
      `| ${site.id} | ${site.category} | ${site.outcome} | ${ms(site.observation_ms)} | ${s ? s.nodes : DASH} | ${s ? s.content_fields : DASH} | ${s ? (s.truncated ? `yes (${s.trimmed_nodes})` : 'no') : DASH} | ${s ? breakdown(s.tokens) : DASH} | ${s ? breakdown(s.markers) : DASH} | ${s ? `${s.images_sent} / ${s.image_nodes}` : DASH} | ${s ? breakdown(s.images_omitted) : DASH} | ${s ? s.text_kb : DASH} | ${s ? s.images_kb : DASH} | ${s ? leakCandidates(s) : DASH} |`,
    );
  }

  lines.push('', '| site | `dom.phase_a` | `sanitize.chunk` | `sanitize.ner` | `image.face` | `image.ocr` | `context.assemble` | fail-closed | reasons | residual (incl. likely-public emails) |');
  lines.push('|---|---|---|---|---|---|---|---:|---|---|');
  for (const site of sites) {
    const o = site.perOp;
    lines.push(
      `| ${site.id} | ${p50p95(o['dom.phase_a'])} | ${p50p95(o['sanitize.chunk'])} | ${p50p95(o['sanitize.ner'])} | ${p50p95(o['image.face'])} | ${p50p95(o['image.ocr'])} | ${p50p95(o['context.assemble'])} | ${site.failClosed} | ${breakdown(site.reasons)} | ${site.summary ? breakdown(site.summary.residual) : DASH} |`,
    );
  }

  lines.push('', 'URLs:', '');
  for (const site of sites) lines.push(`- ${site.id}: ${site.url}`);
  return `${lines.join('\n')}\n`;
}
