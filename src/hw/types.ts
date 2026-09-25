// §10: hardware/compute profile, detected once when the compute host starts.

export type ComputeTarget = 'webgpu' | 'wasm';

export interface DeviceProfile {
  browser: 'chromium' | 'gecko' | 'webkit';
  gpu: { available: boolean; vendor?: string; architecture?: string };
  compute: ComputeTarget;
  hardwareConcurrency: number;
  // Fields not exposed by a browser are left undefined, never guessed (§10.2).
  deviceMemoryGB?: number;
  platform?: string;
  // M10: set only when a benchmark build forced `compute` (§10 override).
  compute_forced?: true;
}
