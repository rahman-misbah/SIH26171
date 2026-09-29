import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectDevice } from '@/hw/detect';

function stubNavigator(overrides: Record<string, unknown>): void {
  vi.stubGlobal('navigator', { hardwareConcurrency: 8, ...overrides });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detectDevice', () => {
  it('picks webgpu for a dedicated GPU, asking for the high-performance adapter', async () => {
    const requestAdapter = vi.fn(() => Promise.resolve({ info: { vendor: 'nvidia', architecture: 'ampere' } }));
    stubNavigator({ gpu: { requestAdapter } });

    const profile = await detectDevice('chromium');

    expect(requestAdapter).toHaveBeenCalledWith({ powerPreference: 'high-performance' });
    expect(profile.compute).toBe('webgpu');
    expect(profile.gpu).toEqual({ available: true, vendor: 'nvidia', architecture: 'ampere', kind: 'discrete', usable: true });
  });

  it('uses wasm on an integrated GPU, but records it', async () => {
    stubNavigator({ gpu: { requestAdapter: () => Promise.resolve({ info: { vendor: 'intel', architecture: 'gen-9' } }) } });

    const profile = await detectDevice('chromium');

    expect(profile.compute).toBe('wasm');
    expect(profile.gpu).toEqual({ available: true, vendor: 'intel', architecture: 'gen-9', kind: 'integrated', usable: false });
  });

  it('uses wasm when it cannot tell (AMD APU vs Radeon card)', async () => {
    stubNavigator({ gpu: { requestAdapter: () => Promise.resolve({ info: { vendor: 'amd', architecture: 'gcn-5' } }) } });

    expect((await detectDevice('chromium')).compute).toBe('wasm');
  });

  it('uses webgpu on Apple Silicon', async () => {
    stubNavigator({ gpu: { requestAdapter: () => Promise.resolve({ info: { vendor: 'apple', architecture: 'metal-3' } }) } });

    expect((await detectDevice('chromium')).compute).toBe('webgpu');
  });

  it('uses wasm on a fallback (software) adapter', async () => {
    stubNavigator({ gpu: { requestAdapter: () => Promise.resolve({ isFallbackAdapter: true, info: { vendor: 'nvidia' } }) } });

    expect((await detectDevice('chromium')).compute).toBe('wasm');
  });

  it('falls back to wasm when navigator.gpu is absent', async () => {
    stubNavigator({});

    const profile = await detectDevice('gecko');

    expect(profile.compute).toBe('wasm');
    expect(profile.gpu).toEqual({ available: false });
  });

  it('falls back to wasm when requestAdapter resolves null', async () => {
    stubNavigator({ gpu: { requestAdapter: () => Promise.resolve(null) } });

    const profile = await detectDevice('chromium');

    expect(profile.compute).toBe('wasm');
    expect(profile.gpu).toEqual({ available: false });
  });

  it('fails closed to wasm when requestAdapter throws', async () => {
    stubNavigator({
      gpu: {
        requestAdapter: () => Promise.reject(new Error('driver error')),
      },
    });

    const profile = await detectDevice('chromium');

    expect(profile.compute).toBe('wasm');
    expect(profile.gpu).toEqual({ available: false });
  });

  it('never guesses fields the browser does not expose', async () => {
    stubNavigator({});

    const profile = await detectDevice('gecko');

    expect(profile.deviceMemoryGB).toBeUndefined();
    expect(profile.platform).toBeUndefined();
  });

  it('passes through fields the browser does expose', async () => {
    stubNavigator({ deviceMemory: 16, userAgentData: { platform: 'Linux' }, hardwareConcurrency: 12 });

    const profile = await detectDevice('chromium');

    expect(profile.deviceMemoryGB).toBe(16);
    expect(profile.platform).toBe('Linux');
    expect(profile.hardwareConcurrency).toBe(12);
    expect(profile.browser).toBe('chromium');
  });

  // M10: benchmark builds force one compute path so a single machine can
  // produce both columns of the WebGPU-vs-WASM table (docs/BENCHMARKS.md).
  describe('forced compute (benchmark builds only)', () => {
    const adapter = { requestAdapter: () => Promise.resolve({ info: { vendor: 'nvidia' } }) };

    it('forces wasm even when an adapter is available, and flags the profile', async () => {
      stubNavigator({ gpu: adapter });
      const profile = await detectDevice('chromium', 'wasm');
      expect(profile.compute).toBe('wasm');
      expect(profile.gpu.available).toBe(true);
      expect(profile.compute_forced).toBe(true);
    });

    it('forces webgpu only when a dedicated GPU exists', async () => {
      stubNavigator({ gpu: adapter });
      const profile = await detectDevice('chromium', 'webgpu');
      expect(profile.compute).toBe('webgpu');
      expect(profile.compute_forced).toBe(true);
    });

    it('fails closed to wasm when webgpu is forced without an adapter', async () => {
      stubNavigator({});
      const profile = await detectDevice('chromium', 'webgpu');
      expect(profile.compute).toBe('wasm');
      expect(profile.compute_forced).toBeUndefined();
    });

    it('fails closed to wasm when webgpu is forced on an integrated GPU', async () => {
      stubNavigator({ gpu: { requestAdapter: () => Promise.resolve({ info: { vendor: 'intel', architecture: 'gen-9' } }) } });
      const profile = await detectDevice('chromium', 'webgpu');
      expect(profile.compute).toBe('wasm');
      expect(profile.compute_forced).toBeUndefined();
    });

    it('leaves the profile unflagged without a force', async () => {
      stubNavigator({ gpu: adapter });
      expect((await detectDevice('chromium')).compute_forced).toBeUndefined();
    });
  });
});
