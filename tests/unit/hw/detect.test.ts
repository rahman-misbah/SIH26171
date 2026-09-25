import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectDevice } from '@/hw/detect';

function stubNavigator(overrides: Record<string, unknown>): void {
  vi.stubGlobal('navigator', { hardwareConcurrency: 8, ...overrides });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detectDevice', () => {
  it('picks webgpu when an adapter is available, and records its info', async () => {
    stubNavigator({
      gpu: {
        requestAdapter: () =>
          Promise.resolve({ info: { vendor: 'test-vendor', architecture: 'test-arch' } }),
      },
    });

    const profile = await detectDevice('chromium');

    expect(profile.compute).toBe('webgpu');
    expect(profile.gpu).toEqual({ available: true, vendor: 'test-vendor', architecture: 'test-arch' });
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
    const adapter = { requestAdapter: () => Promise.resolve({}) };

    it('forces wasm even when an adapter is available, and flags the profile', async () => {
      stubNavigator({ gpu: adapter });
      const profile = await detectDevice('chromium', 'wasm');
      expect(profile.compute).toBe('wasm');
      expect(profile.gpu.available).toBe(true);
      expect(profile.compute_forced).toBe(true);
    });

    it('forces webgpu only when a real adapter exists', async () => {
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

    it('leaves the profile unflagged without a force', async () => {
      stubNavigator({ gpu: adapter });
      expect((await detectDevice('chromium')).compute_forced).toBeUndefined();
    });
  });
});
