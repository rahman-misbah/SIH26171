// §10: is this WebGPU adapter a dedicated GPU? Only a dedicated GPU (or Apple
// Silicon) runs the models; everything else, including "not sure", uses the
// CPU (wasm) path. Browsers don't report discrete vs integrated by default,
// so this reads what they do expose and refuses when that isn't enough.

export type GpuKind = 'discrete' | 'integrated' | 'software' | 'unknown';

export interface AdapterFacts {
  vendor?: string;
  architecture?: string;
  // Chrome only, behind --enable-webgpu-developer-features: "discrete GPU",
  // "integrated GPU", "CPU" or "unknown". Used when present.
  type?: string;
  isFallbackAdapter?: boolean;
}

// CPU emulators some browsers expose as a WebGPU adapter (SPEC §4.3 item 19).
const SOFTWARE = /swiftshader|llvmpipe|lavapipe|software/;

// Integrated-only vendors: phone/laptop SoC GPUs.
const INTEGRATED_VENDORS = new Set(['apple', 'qualcomm', 'arm', 'imgtec', 'imagination', 'broadcom', 'samsung']);

export function classifyGpu(facts: AdapterFacts): GpuKind {
  if (facts.isFallbackAdapter === true) return 'software';

  const type = facts.type?.toLowerCase() ?? '';
  if (type.includes('discrete')) return 'discrete';
  if (type.includes('integrated')) return 'integrated';
  if (type === 'cpu') return 'software';

  const vendor = facts.vendor?.toLowerCase() ?? '';
  const arch = facts.architecture?.toLowerCase() ?? '';
  if (SOFTWARE.test(vendor) || SOFTWARE.test(arch)) return 'software';

  // NVIDIA's only integrated parts are Tegra/Jetson boards, not desktop browsers.
  if (vendor === 'nvidia') return 'discrete';
  // Chrome names Intel Arc architectures with "hp" (gen-12hp = Alchemist,
  // xe-2hpg = Battlemage); the laptop/desktop iGPUs are gen-N, gen-12lp, xe-lpg.
  if (vendor === 'intel') return arch.includes('hp') ? 'discrete' : 'integrated';
  if (INTEGRATED_VENDORS.has(vendor)) return 'integrated';
  // AMD APUs (Ryzen laptops) and Radeon cards report the same architecture
  // names (gcn-5, rdna-2, rdna-3), so AMD without `type` stays unknown.
  return 'unknown';
}

// Apple Silicon is the one integrated exception (user decision, 2026-09-29):
// its GPU is far faster than the wasm path, unlike other integrated GPUs.
export function isGpuUsable(kind: GpuKind, vendor: string | undefined): boolean {
  if (kind === 'discrete') return true;
  return kind === 'integrated' && vendor?.toLowerCase() === 'apple';
}
