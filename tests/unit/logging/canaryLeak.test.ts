// §18 item 1 (the log-export half): LogRecord/SessionRecord have no free-text
// field by construction (§11.2, CLAUDE.md), so this should hold trivially —
// but "should" isn't "does," and this is cheap insurance against a future
// field slipping in `ref`/`model_id`/etc. that isn't actually opaque.

import { describe, expect, it } from 'vitest';
import { createLogger, exportLogs, ReasonCodeError } from '@/logging';
import { loadCanaries } from '../../fixtures/loadCanaries';
import { createFakeSink } from './fakeSink';

describe('exported logs never contain canary values (§18.1)', () => {
  it('JSON and CSV export contain no canary value', async () => {
    const canaries = loadCanaries();
    const sink = createFakeSink();
    const logger = createLogger(sink);

    logger.recordSession({
      session_id: 'canary-session',
      started_at: Date.now(),
      device: { browser: 'chromium', gpu: { available: false }, compute: 'wasm', hardwareConcurrency: 4 },
      models: [],
      backend_id: 'mock',
    });

    await logger.timed('dom.phase_a', { session_id: 'canary-session', ref: 'n0' }, () => Promise.resolve('ok'));
    await logger
      .timed('sanitize.chunk', { session_id: 'canary-session' }, () => {
        throw new ReasonCodeError('unknown', canaries[0]?.value ?? 'boom');
      })
      .catch(() => {});

    await logger.flush();
    logger.stop();

    const json = await exportLogs(sink, 'json');
    const csv = await exportLogs(sink, 'csv');

    for (const canary of canaries) {
      expect(json).not.toContain(canary.value);
      expect(csv).not.toContain(canary.value);
    }
  });
});
