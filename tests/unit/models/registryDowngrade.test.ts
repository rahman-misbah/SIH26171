import { describe, expect, it, vi } from 'vitest';
import type { LogRecord, ModelLoadEntry } from '@/logging';
import type { ModelProvider } from '@/models/provider';

// M11 (§9.4): when the selected provider fails to *load*, the registry tries
// the next lower tier for the rest of the session and logs the downgrade.
const brokenTier2: ModelProvider<'face'> = {
  id: 'face/tier2',
  capability: 'face',
  tier: 2,
  requires: { webgpu: true },
  approxDownloadMB: 0,
  load: async () => {
    throw new Error('no adapter');
  },
  dispose: async () => {},
};
const tier1: ModelProvider<'face'> = {
  id: 'face/tier1',
  capability: 'face',
  tier: 1,
  requires: {},
  approxDownloadMB: 0,
  load: async () => ({ detect: async () => [{ box: { x: 0, y: 0, w: 1, h: 1 }, confidence: 'high' }] }),
  dispose: async () => {},
};

vi.mock('@/models/models.config', () => ({ modelProviders: { face: [brokenTier2, tier1], ocr: [], qr: [], ner: [] } }));

const { configureModelDeps } = await import('@/models/deps');
const { getActiveModelId, getModel } = await import('@/models/registry');

const records: LogRecord[] = [];
const loads: ModelLoadEntry[] = [];
configureModelDeps({
  compute: 'webgpu',
  assetUrl: (p) => p,
  session_id: 's',
  logger: {
    record: (r) => records.push(r),
    recordSession: vi.fn(),
    recordModelLoad: (_s, entry) => loads.push(entry),
    flush: vi.fn(async () => {}),
    stop: vi.fn(),
    timed: async (_op, _meta, fn) => fn(),
  },
});

describe('registry: load-failure downgrade (§9.4)', () => {
  it('falls back to the tier-1 provider when tier 2 fails to load', async () => {
    const detector = await getModel('face');
    await expect(detector.detect({ data: {} as ImageData })).resolves.toHaveLength(1);
    await expect(getActiveModelId('face')).resolves.toBe('face/tier1');
    expect(loads).toEqual([expect.objectContaining({ model_id: 'face/tier1', tier: 1 })]);
  });

  it('logs the downgrade as model.downgrade with the reason, naming the provider now in use', () => {
    const downgrade = records.find((r) => r.op === 'model.downgrade');
    expect(downgrade).toMatchObject({ outcome: 'ok', reason: 'model_load_failed', model_id: 'face/tier1', tier: 1 });
  });
});
