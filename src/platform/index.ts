export type * from './types';
export type * from './messages';

import { createChromiumPlatform, onComputeHostRequest as chromiumOnComputeHostRequest, startBackgroundRelay as chromiumStartBackgroundRelay } from './chromium';
import { createGeckoPlatform, onComputeHostRequest as geckoOnComputeHostRequest, startBackgroundRelay as geckoStartBackgroundRelay } from './gecko';
import { createWebkitPlatform, onComputeHostRequest as webkitOnComputeHostRequest, startBackgroundRelay as webkitStartBackgroundRelay } from './webkit';
import type { Platform } from './types';

// This folder is the ONLY one allowed to import `browser`/`chrome` (SPEC
// §4.2, CLAUDE.md boundaries). `import.meta.env.FIREFOX`/`SAFARI` are
// injected by WXT as build-time literals, so the unused branches below are
// dead-code-eliminated per target build.
let cached: Platform | undefined;

export function getPlatform(): Platform {
  cached ??= import.meta.env.FIREFOX
    ? createGeckoPlatform()
    : import.meta.env.SAFARI
      ? createWebkitPlatform()
      : createChromiumPlatform();
  return cached;
}

// Registers the compute-host-side dispatch function. Call once from whichever
// context is the compute host for this browser (offscreen on Chromium,
// background on Firefox/Safari) -- see src/core/computeHost.ts.
export function onComputeHostRequest(handler: (type: string, payload: unknown) => Promise<unknown>): void {
  if (import.meta.env.FIREFOX) return geckoOnComputeHostRequest(handler);
  if (import.meta.env.SAFARI) return webkitOnComputeHostRequest(handler);
  return chromiumOnComputeHostRequest(handler);
}

// Chromium-only meaningful implementation (§4.3.1 background relay); a no-op
// elsewhere. Call once from background.ts when `platform.name === 'chromium'`.
export function startBackgroundRelay(): void {
  if (import.meta.env.FIREFOX) return geckoStartBackgroundRelay();
  if (import.meta.env.SAFARI) return webkitStartBackgroundRelay();
  return chromiumStartBackgroundRelay();
}
