import { describe, expect, it } from 'vitest';
import type { ModelProvider } from '@/models/provider';
import { candidateProviders } from '@/models/select';

function face(id: string, tier: 1 | 2, requires: ModelProvider<'face'>['requires']): ModelProvider<'face'> {
  return { id, capability: 'face', tier, requires, approxDownloadMB: 0, load: async () => ({ detect: async () => [] }), dispose: async () => {} };
}

const strong = face('face/strong', 2, { webgpu: true });
const light = face('face/light', 1, {});
const providers = [strong, light];

const ids = (r: ReturnType<typeof candidateProviders<'face'>>) => r.candidates.map((p) => p.id);

describe('candidateProviders (§9.4 selection + fallback order)', () => {
  it('picks tier 2 first on a WebGPU device, tier 1 as its fallback', () => {
    expect(ids(candidateProviders(providers, 'webgpu'))).toEqual(['face/strong', 'face/light']);
  });

  it('skips a provider whose requires the device does not meet', () => {
    expect(ids(candidateProviders(providers, 'wasm'))).toEqual(['face/light']);
  });

  it('puts a user override first even when its requires is not met (M11 decision)', () => {
    expect(ids(candidateProviders(providers, 'wasm', 'face/strong'))).toEqual(['face/strong', 'face/light']);
  });

  it('keeps the automatic order after the override, without repeating it', () => {
    expect(ids(candidateProviders(providers, 'webgpu', 'face/light'))).toEqual(['face/light', 'face/strong']);
  });

  it('ignores an unknown override id and reports it', () => {
    const result = candidateProviders(providers, 'wasm', 'face/nope');
    expect(ids(result)).toEqual(['face/light']);
    expect(result.overrideUnknown).toBe(true);
  });

  it('reports no unknown override when none is set', () => {
    expect(candidateProviders(providers, 'wasm').overrideUnknown).toBe(false);
  });
});
