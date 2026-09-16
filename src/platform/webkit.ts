// §4.2/§4.3.6: Safari build-only stub. Safari's MV3 background is an event
// page by default, same model as Firefox (§4.1's table), so this delegates
// to gecko.ts's implementation with the name overridden. Safari is not in
// the demo test matrix (§4.4) — unverified beyond compiling.

import { createGeckoPlatform, onComputeHostRequest, startBackgroundRelay } from './gecko';
import type { Platform } from './types';

export function createWebkitPlatform(): Platform {
  return { ...createGeckoPlatform(), name: 'webkit' };
}

export { onComputeHostRequest, startBackgroundRelay };
