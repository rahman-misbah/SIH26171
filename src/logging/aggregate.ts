// §11.2: the small aggregator that produces the presentation numbers —
// p50/p95 latency per op, cache hit rate, fail-closed count.

import type { LogRecord, OpName } from './schema';

export interface OpStats {
  p50: number;
  p95: number;
  count: number;
}

export interface Aggregate {
  perOp: Partial<Record<OpName, OpStats>>;
  cacheHitRate?: number;
  failClosedCount: number;
}

function percentile(sortedAscending: number[], p: number): number {
  const index = Math.min(sortedAscending.length - 1, Math.floor(p * sortedAscending.length));
  return sortedAscending[index] ?? 0;
}

export function aggregate(records: LogRecord[]): Aggregate {
  const durationsByOp = new Map<OpName, number[]>();
  let cacheHits = 0;
  let cacheMisses = 0;
  let failClosedCount = 0;

  for (const record of records) {
    if (record.outcome === 'fail_closed') failClosedCount += 1;
    if (record.op === 'image.cache_hit') cacheHits += 1;
    if (record.op === 'image.cache_miss') cacheMisses += 1;

    const durations = durationsByOp.get(record.op) ?? [];
    durations.push(record.duration_ms);
    durationsByOp.set(record.op, durations);
  }

  const perOp: Partial<Record<OpName, OpStats>> = {};
  for (const [op, durations] of durationsByOp) {
    const sorted = [...durations].sort((a, b) => a - b);
    perOp[op] = { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), count: sorted.length };
  }

  return {
    perOp,
    cacheHitRate: cacheHits + cacheMisses > 0 ? cacheHits / (cacheHits + cacheMisses) : undefined,
    failClosedCount,
  };
}
