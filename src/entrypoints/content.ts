import { getPlatform } from '@/platform';

export default defineContentScript({
  // The agent must be able to act on whatever page the user is on; egress is
  // controlled separately via optional_host_permissions (SPEC §12.4, §13.4).
  matches: ['<all_urls>'],
  main() {
    // DOM extraction, element registry, action executor arrive in M5/M6.

    // Test-only: proves the real content-script -> compute-host -> content-script
    // path (§4.3.1) end to end, and measures a large binary payload's round trip
    // (§4.3.7). __EDWARD_E2E__ is false (and this whole block dead-code-eliminated)
    // outside `npm run test:e2e` -- see wxt.config.ts and tests/e2e/ping.spec.ts.
    if (__EDWARD_E2E__) {
      const platform = getPlatform();

      const plainStart = performance.now();
      void platform.transport.request('ping', {}).then(() => {
        document.documentElement.dataset.edwardPingMs = String(performance.now() - plainStart);
      });

      const oneMib = new ArrayBuffer(1024 * 1024);
      const binaryStart = performance.now();
      void platform.transport.request('ping', { echo: oneMib }).then(() => {
        document.documentElement.dataset.edwardPingBinMs = String(performance.now() - binaryStart);
      });
    }
  },
});
