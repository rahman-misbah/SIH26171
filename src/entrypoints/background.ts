import { bootstrapComputeHost } from '@/core';
import { getPlatform, startBackgroundRelay } from '@/platform';

export default defineBackground({
  type: 'module',
  main() {
    const platform = getPlatform();
    if (platform.name === 'chromium') {
      // Router only (§3 architecture) -- the offscreen document is the
      // compute host and bootstraps itself (src/entrypoints/offscreen/main.ts).
      startBackgroundRelay();
    } else {
      // No offscreen document on Firefox/Safari -- the background event page
      // is the compute host (§4.1).
      void bootstrapComputeHost(platform);
    }
  },
});
