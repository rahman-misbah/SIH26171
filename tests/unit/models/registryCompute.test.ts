import { describe, expect, it, vi } from 'vitest';
import type { LogRecord, ModelLoadEntry } from '@/logging';
import type { ModelProvider } from '@/models/provider';

// M10 (M9 Noticed #3, §10.3): model.load and the session's model list must
// report the compute a provider actually runs on, not the global decision.
const wasmOnlyOcr: ModelProvider<'ocr'> = {
  id: 'ocr/wasm-only',
  capability: 'ocr',
  tier: 1,
  requires: {},
  approxDownloadMB: 0,
  effectiveCompute: () => 'wasm',
  load: async () => ({ read: async () => [] }),
  dispose: async () => {},
};
const followsGlobalQr: ModelProvider<'qr'> = {
  id: 'qr/follows-global',
  capability: 'qr',
  tier: 1,
  requires: {},
  approxDownloadMB: 0,
  load: async () => ({ detect: async () => [] }),
  dispose: async () => {},
};

vi.mock('@/models/models.config', () => ({ modelProviders: { face: [], ocr: [wasmOnlyOcr], qr: [followsGlobalQr], ner: [] } }));

const { configureModelDeps } = await import('@/models/deps');
const { getModel } = await import('@/models/registry');

const timedMeta: Partial<LogRecord>[] = [];
const loads: ModelLoadEntry[] = [];
configureModelDeps({
  compute: 'webgpu',
  assetUrl: (p) => p,
  session_id: 's',
  logger: {
    record: vi.fn(),
    recordSession: vi.fn(),
    recordModelLoad: (_s, entry) => loads.push(entry),
    flush: vi.fn(async () => {}),
    stop: vi.fn(),
    timed: async (_op, meta, fn) => {
      timedMeta.push(meta);
      return fn();
    },
  },
});

describe('registry: effective compute per provider (§10.3)', () => {
  it('logs a wasm-only provider as wasm on a webgpu device', async () => {
    await getModel('ocr');
    expect(timedMeta.find((m) => m.model_id === 'ocr/wasm-only')?.compute).toBe('wasm');
    expect(loads.find((l) => l.model_id === 'ocr/wasm-only')?.compute).toBe('wasm');
  });

  it('logs the global decision for a provider without effectiveCompute', async () => {
    await getModel('qr');
    expect(timedMeta.find((m) => m.model_id === 'qr/follows-global')?.compute).toBe('webgpu');
    expect(loads.find((l) => l.model_id === 'qr/follows-global')?.compute).toBe('webgpu');
  });
});
