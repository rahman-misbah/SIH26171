import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger, ReasonCodeError } from '@/logging';
import { createFakeSink } from './fakeSink';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createLogger.timed', () => {
  it('records an ok outcome with timing on success', async () => {
    const sink = createFakeSink();
    const logger = createLogger(sink);

    const result = await logger.timed('dom.phase_a', { session_id: 's1' }, async () => 'value');

    expect(result).toBe('value');
    await logger.flush();
    expect(sink.records).toHaveLength(1);
    const record = sink.records[0];
    expect(record?.outcome).toBe('ok');
    expect(record?.op).toBe('dom.phase_a');
    expect(record?.reason).toBeUndefined();
    expect(record?.duration_ms).toBeGreaterThanOrEqual(0);
    logger.stop();
  });

  it('records a fail outcome with reason "unknown" for a plain thrown error, and rethrows', async () => {
    const sink = createFakeSink();
    const logger = createLogger(sink);

    await expect(
      logger.timed('sanitize.regex', { session_id: 's1' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await logger.flush();
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]).toMatchObject({ outcome: 'fail', reason: 'unknown' });
    logger.stop();
  });

  it('maps a ReasonCodeError to its declared reason instead of "unknown"', async () => {
    const sink = createFakeSink();
    const logger = createLogger(sink);

    await expect(
      logger.timed('image.face', { session_id: 's1' }, async () => {
        throw new ReasonCodeError('webgpu_device_lost');
      }),
    ).rejects.toThrow();

    await logger.flush();
    expect(sink.records[0]).toMatchObject({ outcome: 'fail', reason: 'webgpu_device_lost' });
    logger.stop();
  });

  it('caps the ring buffer at 10,000 records', async () => {
    const sink = createFakeSink();
    const logger = createLogger(sink);

    for (let i = 0; i < 10_005; i++) {
      await logger.timed('agent.step', { session_id: 's1' }, async () => undefined);
    }

    await logger.flush();
    expect(sink.records).toHaveLength(10_000);
    logger.stop();
  });

  it('flushes periodically without the caller awaiting it', async () => {
    const sink = createFakeSink();
    const logger = createLogger(sink);

    await logger.timed('agent.step', { session_id: 's1' }, async () => undefined);
    expect(sink.records).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(sink.records).toHaveLength(1);
    logger.stop();
  });

  it('flushes a recorded session', async () => {
    const sink = createFakeSink();
    const logger = createLogger(sink);

    logger.recordSession({
      session_id: 's1',
      started_at: Date.now(),
      device: { browser: 'chromium', gpu: { available: false }, compute: 'wasm', hardwareConcurrency: 4 },
      models: [],
      backend_id: 'unassigned',
    });

    await logger.flush();
    expect(sink.sessions).toHaveLength(1);
    expect(sink.sessions[0]?.session_id).toBe('s1');
    logger.stop();
  });
});
