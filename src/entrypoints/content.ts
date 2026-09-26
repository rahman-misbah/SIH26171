import { MOCK_SCRIPT_STORAGE_KEY, setBackendSettings, type BackendSettings } from '@/backend';
import { attachAgentSession, observePage } from '@/dom';
import { readPixels } from '@/dom/readPixels';
import { getPlatform } from '@/platform';

export default defineContentScript({
  // The agent must be able to act on whatever page the user is on; egress is
  // controlled separately via optional_host_permissions (SPEC §12.4, §13.4).
  matches: ['<all_urls>'],
  main() {
    const platform = getPlatform();

    // §13.2/§4.3.5: the real agent loop, driven by popup start/stop pushes.
    const session = attachAgentSession(platform, document);

    // Test-only: proves the real content-script -> compute-host -> content-script
    // path (§4.3.1) end to end, and measures a large binary payload's round trip
    // (§4.3.7). __EDWARD_E2E__ is false (and this whole block dead-code-eliminated)
    // outside `npm run test:e2e` -- see wxt.config.ts and tests/e2e/ping.spec.ts.
    if (__EDWARD_E2E__) {
      const plainStart = performance.now();
      void platform.transport.request('ping', {}).then(() => {
        document.documentElement.dataset.edwardPingMs = String(performance.now() - plainStart);
      });

      const oneMib = new ArrayBuffer(1024 * 1024);
      const binaryStart = performance.now();
      void platform.transport.request('ping', { echo: oneMib }).then(() => {
        document.documentElement.dataset.edwardPingBinMs = String(performance.now() - binaryStart);
      });

      // Triggers one observation directly and reads the result off the DOM,
      // for tests that only need a read (canary.spec.ts) rather than a full
      // agent-loop run. M12: the observation's wall time is stamped too, for
      // the real-site pass (tests/realsites).
      const observeStart = performance.now();
      void observePage(platform.transport, document, {
        session_id: crypto.randomUUID(),
        step: 0,
        task: 'fixture walkthrough (no canaries in the task string itself)',
        origin: location.origin,
        backend_id: 'mock',
      })
        .then((result) => {
          document.documentElement.dataset.edwardObservationMs = String(performance.now() - observeStart);
          // Image bytes (ObservationImage.data, a Uint8Array) as base64, so
          // the e2e suite can decode and re-OCR the outgoing images (§18.1).
          document.documentElement.dataset.edwardObservation = JSON.stringify(result, (_key, value: unknown) =>
            value instanceof Uint8Array ? { base64: btoa(Array.from(value, (b) => String.fromCharCode(b)).join('')) } : value,
          );
        })
        .catch((error: unknown) => {
          document.documentElement.dataset.edwardObservation = JSON.stringify({
            status: 'error',
            // `name` alone is safe to print; `message` can quote page
            // content (a selector error embeds the page's element id).
            name: error instanceof Error ? error.name : 'unknown',
            message: error instanceof Error ? error.message : 'unknown',
          });
        });

      // tests/e2e/agentLoop.spec.ts drives the real agent loop the same way
      // the popup does (attachAgentSession's onTabPush path), via a DOM
      // signal rather than window globals: Playwright's page.evaluate runs
      // in the page's *main* world, which shares the DOM with this isolated-
      // world content script but not its JS globals.
      new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type !== 'attributes') continue;
          if (mutation.attributeName === 'data-edward-e2e-seed-script') {
            const raw = document.documentElement.dataset.edwardE2eSeedScript;
            if (raw === undefined) continue;
            // The attribute is deleted only once the write resolves, since
            // tests/e2e/agentLoop.spec.ts's seedScript() treats its removal
            // as "safe to start the task now" -- deleting it first would let
            // startTask() race ahead of the write it depends on.
            void platform.settings.set(MOCK_SCRIPT_STORAGE_KEY, JSON.parse(raw)).then(() => {
              delete document.documentElement.dataset.edwardE2eSeedScript;
            });
          } else if (mutation.attributeName === 'data-edward-e2e-seed-backend') {
            // M11: tests/e2e/httpBackend.spec.ts selects the http backend and
            // its mock server's endpoint. Removed once written, like the
            // script seed above.
            const raw = document.documentElement.dataset.edwardE2eSeedBackend;
            if (raw === undefined) continue;
            void setBackendSettings(platform.settings, JSON.parse(raw) as BackendSettings).then(() => {
              delete document.documentElement.dataset.edwardE2eSeedBackend;
            });
          } else if (mutation.attributeName === 'data-edward-e2e-face-detect') {
            // M11: tests/bench/faceRecall.spec.ts reads the face detector's
            // raw boxes for the page's first image (e2eFaceDetect).
            if (document.documentElement.dataset.edwardE2eFaceDetect === undefined) continue;
            delete document.documentElement.dataset.edwardE2eFaceDetect;
            const img = document.images[0];
            void (async () => {
              const read = img ? await readPixels(img) : undefined;
              const result = read?.ok ? await platform.transport.request('e2eFaceDetect', { png: read.png }) : { error: 'unreadable' };
              document.documentElement.dataset.edwardE2eFaceBoxes = JSON.stringify(result);
            })();
          } else if (mutation.attributeName === 'data-edward-e2e-start-task') {
            const task = document.documentElement.dataset.edwardE2eStartTask;
            if (task === undefined) continue;
            delete document.documentElement.dataset.edwardE2eStartTask;
            session.startTask(task);
          }
        }
      }).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-edward-e2e-seed-script', 'data-edward-e2e-seed-backend', 'data-edward-e2e-face-detect', 'data-edward-e2e-start-task'],
      });
    }
  },
});
