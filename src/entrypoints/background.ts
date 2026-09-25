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
      // §15 warm start (M10): create the compute host whenever the service
      // worker starts (browser start, install, or any later wake), so models
      // are loaded before the first task rather than on it. Idempotent: an
      // existing offscreen document is reused. A failure here only means the
      // host is created on demand later, as before.
      void platform.ensureComputeHost().catch(() => undefined);
    } else {
      // No offscreen document on Firefox/Safari -- the background event page
      // is the compute host (§4.1).
      void bootstrapComputeHost(platform);
    }
  },
});
