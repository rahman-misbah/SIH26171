import { describe, expect, it } from 'vitest';
import { exportLogs } from '@/logging';
import { createFakeSink } from './fakeSink';

describe('exportLogs', () => {
  it('exports JSON with both records and sessions', async () => {
    const sink = createFakeSink();
    await sink.putRecords([
      { session_id: 's1', op: 'dom.phase_a', t_start: 0, t_end: 1, duration_ms: 1, outcome: 'ok' },
    ]);
    await sink.putSession({
      session_id: 's1',
      started_at: 0,
      device: { browser: 'chromium', gpu: { available: false }, compute: 'wasm', hardwareConcurrency: 4 },
      models: [],
      backend_id: 'unassigned',
    });

    const json = JSON.parse(await exportLogs(sink, 'json')) as { records: unknown[]; sessions: unknown[] };

    expect(json.records).toHaveLength(1);
    expect(json.sessions).toHaveLength(1);
  });

  it('exports CSV with a header row and one row per record', async () => {
    const sink = createFakeSink();
    await sink.putRecords([
      { session_id: 's1', op: 'dom.phase_a', t_start: 0, t_end: 1, duration_ms: 1, outcome: 'ok' },
      { session_id: 's1', op: 'sanitize.regex', t_start: 1, t_end: 3, duration_ms: 2, outcome: 'fail', reason: 'unknown' },
    ]);

    const csv = await exportLogs(sink, 'csv');
    const lines = csv.split('\n');

    expect(lines[0]).toBe('session_id,step,op,t_start,t_end,duration_ms,outcome,reason,ref,model_id,tier,compute');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('sanitize.regex');
    expect(lines[2]).toContain('unknown');
  });

  it('never puts raw content in the export — only enum/number/opaque-id fields exist on LogRecord', async () => {
    const sink = createFakeSink();
    await sink.putRecords([{ session_id: 's1', op: 'dom.phase_a', t_start: 0, t_end: 1, duration_ms: 1, outcome: 'ok' }]);

    const json = JSON.parse(await exportLogs(sink, 'json')) as { records: Record<string, unknown>[] };
    const allowedKeys = new Set([
      'session_id',
      'step',
      'op',
      't_start',
      't_end',
      'duration_ms',
      'outcome',
      'reason',
      'ref',
      'model_id',
      'tier',
      'compute',
      'counts',
    ]);

    for (const key of Object.keys(json.records[0] ?? {})) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });
});
