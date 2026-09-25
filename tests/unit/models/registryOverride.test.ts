import { describe, expect, it, vi } from 'vitest';
import type { LogRecord } from '@/logging';
import type { ModelProvider } from '@/models/provider';

// M11 (§9.4 "the user may override in settings"): switching the face tier
// needs only the model settings, not a code change.
function provider(id: string, tier: 1 | 2, requires: ModelProvider<'face'>['requires']): ModelProvider<'face'> {
  return { id, capability: 'face', tier, requires, approxDownloadMB: 0, load: async () => ({ detect: async () => [] }), dispose: async () => {} };
}

vi.mock('@/models/models.config', () => ({
  modelProviders: {
    face: [provider('face/tier2', 2, { webgpu: true }), provider('face/tier1', 1, {})],
    ocr: [],
    qr: [provider('qr/only', 1, {}) as unknown as ModelProvider<'qr'>],
    ner: [],
  },
}));

const { configureModelDeps } = await import('@/models/deps');
const { getActiveModelId } = await import('@/models/registry');

const records: LogRecord[] = [];
configureModelDeps({
  compute: 'wasm',
  assetUrl: (p) => p,
  session_id: 's',
  overrides: { face: 'face/tier2', qr: 'qr/unknown' },
  logger: {
    record: (r) => records.push(r),
    recordSession: vi.fn(),
    recordModelLoad: vi.fn(),
    flush: vi.fn(async () => {}),
    stop: vi.fn(),
    timed: async (_op, _meta, fn) => fn(),
  },
});

describe('registry: model override from settings (§9.4)', () => {
  it('loads the overridden tier-2 face provider on a wasm device', async () => {
    await expect(getActiveModelId('face')).resolves.toBe('face/tier2');
  });

  it('ignores an unknown override, keeps automatic selection, and logs it', async () => {
    await expect(getActiveModelId('qr')).resolves.toBe('qr/only');
    expect(records).toContainEqual(expect.objectContaining({ op: 'model.load', outcome: 'skipped', reason: 'model_override_unknown' }));
  });
});
