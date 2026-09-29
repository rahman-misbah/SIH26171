import { describe, expect, it } from 'vitest';
import { classifyGpu, isGpuUsable } from '@/hw/gpuKind';

describe('classifyGpu', () => {
  it('trusts the browser-reported adapter type when present', () => {
    expect(classifyGpu({ vendor: 'amd', architecture: 'rdna-3', type: 'discrete GPU' })).toBe('discrete');
    expect(classifyGpu({ vendor: 'nvidia', type: 'integrated GPU' })).toBe('integrated');
    expect(classifyGpu({ vendor: 'google', type: 'CPU' })).toBe('software');
  });

  it('treats fallback adapters and CPU emulators as software', () => {
    expect(classifyGpu({ vendor: 'nvidia', isFallbackAdapter: true })).toBe('software');
    expect(classifyGpu({ vendor: 'google', architecture: 'swiftshader' })).toBe('software');
    expect(classifyGpu({ vendor: 'mesa', architecture: 'llvmpipe' })).toBe('software');
  });

  it('counts NVIDIA as discrete', () => {
    expect(classifyGpu({ vendor: 'nvidia', architecture: 'ampere' })).toBe('discrete');
  });

  it('splits Intel into Arc (discrete) and everything else (integrated)', () => {
    expect(classifyGpu({ vendor: 'intel', architecture: 'gen-12hp' })).toBe('discrete');
    expect(classifyGpu({ vendor: 'intel', architecture: 'xe-2hpg' })).toBe('discrete');
    expect(classifyGpu({ vendor: 'intel', architecture: 'gen-9' })).toBe('integrated');
    expect(classifyGpu({ vendor: 'intel', architecture: 'gen-12lp' })).toBe('integrated');
    expect(classifyGpu({ vendor: 'intel', architecture: 'xe-lpg' })).toBe('integrated');
  });

  it('counts mobile/SoC vendors and Apple as integrated', () => {
    expect(classifyGpu({ vendor: 'apple', architecture: 'metal-3' })).toBe('integrated');
    expect(classifyGpu({ vendor: 'qualcomm' })).toBe('integrated');
    expect(classifyGpu({ vendor: 'arm' })).toBe('integrated');
  });

  it('leaves AMD and unknown vendors unknown (APUs and Radeon cards share architecture names)', () => {
    expect(classifyGpu({ vendor: 'amd', architecture: 'gcn-5' })).toBe('unknown');
    expect(classifyGpu({ vendor: 'amd', architecture: 'rdna-2' })).toBe('unknown');
    expect(classifyGpu({})).toBe('unknown');
  });
});

describe('isGpuUsable', () => {
  it('allows discrete GPUs', () => {
    expect(isGpuUsable('discrete', 'nvidia')).toBe(true);
  });

  it('allows Apple Silicon as the one integrated exception', () => {
    expect(isGpuUsable('integrated', 'apple')).toBe(true);
  });

  it('refuses integrated, software and unknown GPUs', () => {
    expect(isGpuUsable('integrated', 'intel')).toBe(false);
    expect(isGpuUsable('software', 'apple')).toBe(false);
    expect(isGpuUsable('unknown', 'amd')).toBe(false);
    expect(isGpuUsable('unknown', undefined)).toBe(false);
  });
});
