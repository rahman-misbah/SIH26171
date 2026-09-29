// §10: hardware/compute detection, run once when the compute host starts.

import { classifyGpu, isGpuUsable } from './gpuKind';
import type { ComputeTarget, DeviceProfile } from './types';

// navigator.gpu (WebGPU) and the Device Memory / UA-CH APIs are experimental
// and not part of TypeScript's lib.dom; these are the minimal shapes §10
// actually reads, kept local rather than pulling in a full @webgpu/types dep.
interface MinimalGpuAdapter {
  info?: { vendor?: string; architecture?: string; type?: string; isFallbackAdapter?: boolean };
  isFallbackAdapter?: boolean; // older Chrome: on the adapter, not its info
}
interface NavigatorGpu {
  requestAdapter(options?: { powerPreference?: 'low-power' | 'high-performance' }): Promise<MinimalGpuAdapter | null>;
}
interface NavigatorExtras {
  gpu?: NavigatorGpu;
  deviceMemory?: number;
  userAgentData?: { platform?: string };
}

// requestAdapter() failures (unsupported, driver issues) fail closed to 'wasm'
// rather than throwing — hardware detection must never crash compute-host startup.
// An adapter that isn't a dedicated GPU (gpuKind.ts) is recorded but not used.
async function detectGpu(nav: NavigatorExtras): Promise<DeviceProfile['gpu']> {
  if (!nav.gpu) return { available: false };
  try {
    // On a laptop with two GPUs, 'high-performance' asks for the dedicated
    // one. Only a hint: Chrome on Linux ignores it (the process's GPU wins).
    const adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { available: false };
    const vendor = adapter.info?.vendor;
    const kind = classifyGpu({
      vendor,
      architecture: adapter.info?.architecture,
      type: adapter.info?.type,
      isFallbackAdapter: adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter,
    });
    return { available: true, vendor, architecture: adapter.info?.architecture, kind, usable: isGpuUsable(kind, vendor) };
  } catch {
    return { available: false };
  }
}

// `force` (M10) comes only from benchmark builds (__EDWARD_FORCE_COMPUTE__,
// wxt.config.ts) so one machine can measure both paths. It can pick wasm on
// a GPU machine, but never webgpu without a usable (dedicated) GPU -- that stays wasm.
function chooseCompute(gpuUsable: boolean, force: ComputeTarget | undefined): { compute: ComputeTarget; forced: boolean } {
  const detected: ComputeTarget = gpuUsable ? 'webgpu' : 'wasm';
  if (force === 'wasm') return { compute: 'wasm', forced: true };
  if (force === 'webgpu' && gpuUsable) return { compute: 'webgpu', forced: true };
  return { compute: detected, forced: false };
}

export async function detectDevice(browser: DeviceProfile['browser'], force?: ComputeTarget): Promise<DeviceProfile> {
  const nav = navigator as Navigator & NavigatorExtras;
  const gpu = await detectGpu(nav);
  const { compute, forced } = chooseCompute(gpu.usable === true, force);
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
