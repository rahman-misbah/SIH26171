import { observePage } from '@/dom';
import { getPlatform } from '@/platform';

export default defineContentScript({
  // The agent must be able to act on whatever page the user is on; egress is
  // controlled separately via optional_host_permissions (SPEC §12.4, §13.4).
  matches: ['<all_urls>'],
  main() {
    // Element registry / action executor arrive in M6; observePage() (§5, §14)
    // is the real pipeline as of M5.

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

      // No agent session/UI exists until M6, so the e2e suite triggers one
      // observation directly and reads the result off the DOM (same pattern
      // as the ping hook above) instead of driving a real start/stop flow.
      void observePage(platform.transport, document, {
        session_id: crypto.randomUUID(),
        step: 0,
        task: 'fixture walkthrough (no canaries in the task string itself)',
        origin: location.origin,
      })
        .then((result) => {
          document.documentElement.dataset.edwardObservation = JSON.stringify(result);
        })
        .catch((error: unknown) => {
          document.documentElement.dataset.edwardObservation = JSON.stringify({
            status: 'error',
            message: error instanceof Error ? error.message : 'unknown',
          });
        });
    }
  },
});
