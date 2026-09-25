// §10: hardware/compute detection, run once when the compute host starts.

import type { ComputeTarget, DeviceProfile } from './types';

// navigator.gpu (WebGPU) and the Device Memory / UA-CH APIs are experimental
// and not part of TypeScript's lib.dom; these are the minimal shapes §10
// actually reads, kept local rather than pulling in a full @webgpu/types dep.
interface MinimalGpuAdapter {
  info?: { vendor?: string; architecture?: string };
}
interface NavigatorGpu {
  requestAdapter(): Promise<MinimalGpuAdapter | null>;
}
interface NavigatorExtras {
  gpu?: NavigatorGpu;
  deviceMemory?: number;
  userAgentData?: { platform?: string };
}

// requestAdapter() failures (unsupported, driver issues) fail closed to 'wasm'
// rather than throwing — hardware detection must never crash compute-host startup.
async function detectGpu(nav: NavigatorExtras): Promise<DeviceProfile['gpu']> {
  if (!nav.gpu) return { available: false };
  try {
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) return { available: false };
    return { available: true, vendor: adapter.info?.vendor, architecture: adapter.info?.architecture };
  } catch {
    return { available: false };
  }
}

// `force` (M10) comes only from benchmark builds (__EDWARD_FORCE_COMPUTE__,
// wxt.config.ts) so one machine can measure both paths. It can pick wasm on
// a GPU machine, but never webgpu without a real adapter -- that stays wasm.
function chooseCompute(gpuAvailable: boolean, force: ComputeTarget | undefined): { compute: ComputeTarget; forced: boolean } {
  const detected: ComputeTarget = gpuAvailable ? 'webgpu' : 'wasm';
  if (force === 'wasm') return { compute: 'wasm', forced: true };
  if (force === 'webgpu' && gpuAvailable) return { compute: 'webgpu', forced: true };
  return { compute: detected, forced: false };
}

export async function detectDevice(browser: DeviceProfile['browser'], force?: ComputeTarget): Promise<DeviceProfile> {
  const nav = navigator as Navigator & NavigatorExtras;
  const gpu = await detectGpu(nav);
  const { compute, forced } = chooseCompute(gpu.available, force);
  return {
    browser,
    gpu,
    compute,
    hardwareConcurrency: nav.hardwareConcurrency,
    // Fields the browser doesn't expose stay undefined, never guessed (§10.2).
    deviceMemoryGB: nav.deviceMemory,
    platform: nav.userAgentData?.platform,
    ...(forced ? { compute_forced: true as const } : {}),
  };
}
