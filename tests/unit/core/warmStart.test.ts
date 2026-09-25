import { describe, expect, it, vi } from 'vitest';
import { warmStart, type WarmStartDeps } from '@/core/warmStart';
import type { LogRecord } from '@/logging';
import type { Capability, ImageInput } from '@/models/capabilities';
import type { CapabilityImpl } from '@/models/provider';

function fakeLogger(records: Partial<LogRecord>[]): WarmStartDeps['logger'] {
  return {
    record: vi.fn(),
    recordSession: vi.fn(),
    recordModelLoad: vi.fn(),
    flush: vi.fn(async () => {}),
    stop: vi.fn(),
    // Mirrors logger.timed(): records the outcome, rethrows failures.
    timed: async (op, meta, fn) => {
      try {
        const value = await fn();
        records.push({ ...meta, op, outcome: 'ok' });
        return value;
      } catch (error) {
        records.push({ ...meta, op, outcome: 'fail' });
        throw error;
      }
    },
  };
}

function setup(overrides: Partial<{ [C in Capability]: CapabilityImpl<C> }> = {}) {
  const face = { poolSize: 3, detect: vi.fn<(img: ImageInput) => Promise<never[]>>(async () => []) };
  const ocr = { poolSize: 2, read: vi.fn<(img: ImageInput) => Promise<never[]>>(async () => []) };
  const qr = { detect: vi.fn<(img: ImageInput) => Promise<never[]>>(async () => []) }; // no poolSize: one call
  const ner = { tag: vi.fn(async (texts: string[]) => texts.map(() => [])) };
  const impls = { face, ocr, qr, ner, ...overrides };
  const records: Partial<LogRecord>[] = [];
  const deps: WarmStartDeps = {
    getModel: (async (c: Capability) => impls[c]) as WarmStartDeps['getModel'],
    logger: fakeLogger(records),
    session_id: 's',
    blankImage: () => ({ data: {} as ImageData }),
  };
  return { deps, face, ocr, qr, ner, records };
}

describe('warmStart (§15: models warm before the first task)', () => {
  it('runs one warm-up call per pooled worker, and one for unpooled models', async () => {
    const { deps, face, ocr, qr, ner } = setup();
    await warmStart(deps);
    expect(face.detect).toHaveBeenCalledTimes(3);
    expect(ocr.read).toHaveBeenCalledTimes(2);
    expect(qr.detect).toHaveBeenCalledTimes(1);
    expect(ner.tag).toHaveBeenCalledTimes(1);
  });

  it('gives each concurrent warm-up call its own blank image (no shared, transferable input)', async () => {
    const { deps, face } = setup();
    await warmStart(deps);
    const inputs = face.detect.mock.calls.map(([img]) => img);
    expect(new Set(inputs).size).toBe(3);
  });

  it('warms NER with fixed non-PII text only', async () => {
    const { deps, ner } = setup();
    await warmStart(deps);
    expect(ner.tag).toHaveBeenCalledWith(['warm up']);
  });

  it('logs one model.warmup record per capability', async () => {
    const { deps, records } = setup();
    await warmStart(deps);
    expect(records.filter((r) => r.op === 'model.warmup')).toHaveLength(4);
  });

  it('never rejects when a warm-up fails, and still warms the others', async () => {
    const failingFace = { poolSize: 1, detect: vi.fn(async () => Promise.reject(new Error('boom'))) };
    const { deps, ocr, records } = setup({ face: failingFace });
    await expect(warmStart(deps)).resolves.toBeUndefined();
    expect(ocr.read).toHaveBeenCalled();
    expect(records.find((r) => r.outcome === 'fail')).toBeDefined();
  });

  it('never rejects when a model fails to load', async () => {
    const { deps } = setup();
    deps.getModel = (async () => Promise.reject(new Error('load'))) as WarmStartDeps['getModel'];
    await expect(warmStart(deps)).resolves.toBeUndefined();
  });

  it('warms NER before any image model starts loading', async () => {
    const { deps } = setup();
    const order: string[] = [];
    const inner = deps.getModel;
    deps.getModel = (async (c: Capability) => {
      order.push(`load:${c}`);
      const impl = await inner(c);
      if (c === 'ner') await new Promise((r) => setTimeout(r, 5));
      order.push(`done:${c}`);
      return impl;
    }) as WarmStartDeps['getModel'];
    await warmStart(deps);
    expect(order.indexOf('done:ner')).toBeLessThan(order.indexOf('load:face'));
  });
});
