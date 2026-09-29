import { describe, expect, it } from 'vitest';
import { aggregate } from '@/logging';
import type { LogRecord } from '@/logging';

function record(overrides: Partial<LogRecord> & Pick<LogRecord, 'op'>): LogRecord {
  return {
    session_id: 's1',
    t_start: 0,
    t_end: 0,
    duration_ms: 0,
    outcome: 'ok',
    ...overrides,
  };
}

describe('aggregate', () => {
  it('computes p50/p95 duration per op', () => {
    const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const records = durations.map((duration_ms) => record({ op: 'sanitize.chunk', duration_ms }));

    const result = aggregate(records);

    expect(result.perOp['sanitize.chunk']).toEqual({ p50: 60, p95: 100, count: 10 });
  });

  it('computes cache hit rate from image.cache_hit / (hit + miss)', () => {
    const records = [
      record({ op: 'image.cache_hit' }),
      record({ op: 'image.cache_hit' }),
      record({ op: 'image.cache_hit' }),
      record({ op: 'image.cache_miss' }),
    ];

    expect(aggregate(records).cacheHitRate).toBe(0.75);
  });

  it('leaves cache hit rate undefined when there are no cache events', () => {
    const records = [record({ op: 'dom.phase_a' })];

    expect(aggregate(records).cacheHitRate).toBeUndefined();
  });

  it('counts fail_closed outcomes', () => {
    const records = [
      record({ op: 'image.acquire', outcome: 'fail_closed' }),
      record({ op: 'image.acquire', outcome: 'ok' }),
      record({ op: 'sanitize.ner', outcome: 'fail_closed' }),
    ];

    expect(aggregate(records).failClosedCount).toBe(2);
  });

  it('adds queue-wait percentiles for ops whose records carry queue_ms (M10)', () => {
    const records = [
      ...[0, 0, 0, 100, 200].map((queue_ms) => record({ op: 'image.ocr', duration_ms: 300, queue_ms })),
      record({ op: 'image.face', duration_ms: 5 }),
    ];

    const result = aggregate(records);

    expect(result.perOp['image.ocr']).toEqual({ p50: 300, p95: 300, count: 5, queue: { p50: 0, p95: 200 } });
    expect(result.perOp['image.face']).toEqual({ p50: 5, p95: 5, count: 1 });
  });
});
