# Edward (SIH26171)

Named after Edward Snowden. Not to be confused with the Python reference prototype in `reference/python-prototype/` (which was also called "edward").

Browser extension that acts as a privacy firewall for browser agents: it extracts a sanitized view of the page (DOM + redacted images), sends only that to a pluggable reasoning backend, and executes the returned actions locally.

**Source of truth: `docs/SPEC.md`.** Before working on any module, read the spec sections it cites. If the spec is ambiguous or conflicts with a browser limitation, stop and ask — don't guess.

## Commands
<!-- Update these once the project is scaffolded -->
- `npm run dev` / `npm run dev:firefox` — dev build with reload
- `npm run build` / `npm run build:firefox`
- `npm run check` — `tsc --noEmit` + ESLint (boundary rules)
- `npm test` — Vitest unit tests
- `npm run test:e2e` — Playwright (Chromium, unpacked extension)
- `npm run fetch-models` — downloads tier-1 model weights into `public/models/` (git-ignored)
- `npm run bench -- --label "<machine>"` — WASM vs WebGPU benchmark over the fixtures, written to `docs/BENCHMARKS.md`
- `npm run bench:faces -- --label "<machine>" [--compute wasm|webgpu]` — face recall per provider (BlazeFace vs SCRFD), written to `docs/BENCHMARKS.md`
- `npm run wire-schema` — regenerates `docs/wire/*.schema.json` from the wire types (a unit test fails when they're stale)
- `npm run serve-fixtures` — fixture pages on :8123/:8124 for the manual browser checklist (`docs/BROWSER_CHECKLIST.md`)

## Non-negotiables (SPEC §2, §20)
- Fail closed: uncertain, failed or unreadable → redact or withhold. Never pass through as "clean".
- `SanitizedObservation` is the only thing that leaves the device, for every backend.
- Raw page text is never logged or persisted. Raw image bytes are never persisted.
- The logger receives metrics only (op, timings, device, outcome, reason codes, opaque IDs). No content, no URLs, no library error messages. New failure → add a `ReasonCode`.
- The token map never leaves compute-host memory. Tokens resolve only under the §13.4 egress policy.
- Secret fields (password, OTP, card) are never read.
- No whole-page or multi-node concatenated model input. Micro-batching independent sequences is fine.
- Every exclusion (iframe, canvas, svg, unreadable image, request limit) leaves a marker in the output.

## Boundaries (enforced by ESLint)
- Extension/browser APIs (`browser`, `chrome`) → `src/platform/` only.
- Model libraries (onnxruntime-web, transformers.js, mediapipe, tesseract.js, zxing-wasm) → `src/models/providers/` only.
- Vendor names/APIs → `src/backend/llm/clients/` only.
- Orchestrator and assembler depend only on `AgentBackend` and `SanitizedObservation`.
- Consumers get models via `getModel(capability)`, backends via `getBackend()`.

## Code style
- TypeScript strict. No `any` — use `unknown` + type guards. No `.js` source files (vendored runtime files in `public/` are the only exception).
- Wrap significant operations with `logger.timed(op, meta, fn)`.
- Small files, one responsibility, named exports.
- Unit tests in `tests/unit/` mirroring `src/`.
- Brief comments on non-obvious async/worker/messaging code and on every threshold or weight (the team must be able to explain it to judges).

## Milestones
- The build follows `docs/MILESTONES.md`. Work only on the milestone marked `in progress`; never start the next one on your own.
- Milestones are driven by `/milestone`, `/milestone-check`, `/milestone-quiz`, `/milestone-done`. Only `/milestone-done` may set a milestone to `done`.
- Read the latest "Notes for next milestone" in the Log before planning.
- Out-of-scope issues go in a "Noticed" list, not into the code.

## Workflow
- Use plan mode for each milestone. Plans cite spec sections. Wait for approval before editing.
- Tests first for: regex tier (Verhoeff, Luhn), token map, egress policy, public-email heuristic, response validation.
- Run `npm run check && npm test` before saying a milestone is done.
- Fixtures use synthetic PII only. Never commit API keys.
- Model weights are not committed; `scripts/fetch-models.ts` downloads them into `public/models/`.

## Browser quirks found
<!-- Append here AND to SPEC §4.3 whenever one is discovered -->

- WXT's default `manifestVersion` is 3 for Chrome but **2 for Firefox**. SPEC §4.1 assumes MV3 everywhere (Firefox as an MV3 event page), so `wxt.config.ts` sets `manifestVersion: 3` explicitly.
- WXT never declares both `background.scripts` and `background.service_worker` in one manifest. Instead it builds one manifest per target and picks the right field there: Firefox+MV3 → `background.scripts` (event page), Chrome/Edge+MV3 → `background.service_worker` — both generated from the same `defineBackground()` source file. This satisfies SPEC's "one source, correct type per browser" intent by a different mechanism than the literal wording ("declares both fields") suggests.
- Firefox has no `offscreen` permission/API. Leaving `"offscreen"` in `manifest.permissions` for a Firefox build produces a harmless but avoidable `web-ext lint` warning (`MANIFEST_PERMISSIONS: Invalid permissions "offscreen"`). `wxt.config.ts` uses the `manifest: ({ browser }) => ...` function form to omit it on Firefox.
- Firefox MV3 requires `browser_specific_settings.gecko.id` for AMO submission (`web-ext lint` error `ADDON_ID_REQUIRED`) and, since 2025-11-03, `browser_specific_settings.gecko.data_collection_permissions` for new submissions (`MISSING_DATA_COLLECTION_PERMISSIONS`). Neither is required for local temporary loading (`npm run dev:firefox`, `about:debugging`) — both will be needed before any Firefox packaging/AMO milestone (§17 packaging).
- Playwright's `chromium.launchPersistentContext` needs `headless: false` to reliably observe an MV3 extension's service worker registering (`context.serviceWorkers()` / `waitForEvent('serviceworker')`); confirmed with the Chromium build Playwright 1.63 bundles. `tests/e2e/fixtures.ts` always launches headed for this reason.
- `browser.offscreen.createDocument()` resolves once the document exists, not once its module has finished loading and registered a message listener — a message forwarded immediately after creation can arrive before that listener is live ("Could not establish connection"). Calling `createDocument()` again while one is already being created also throws. `src/platform/chromium.ts` memoizes a single in-flight creation promise and retries the first forward a few times with a short delay.
- Offscreen documents expose almost none of the `chrome.*` API surface — only `chrome.runtime`'s messaging methods (per Chrome's own docs, deliberately, "to reduce the likelihood of extensions using these as a background-page replacement"). `chrome.storage`, `chrome.tabs` and `chrome.permissions` are all unavailable there, not just `tabs`. `src/platform/chromium.ts`'s `settings.get/set/remove` (backed by `chrome.storage.local`) detect this (`typeof browser.storage?.local?.get === 'function'`) and relay through the background service worker, the same pattern already used for tab-bound calls.
- Chromium treats a content script's `matches` (`<all_urls>` here) as extension-wide host permissions, so the offscreen document's `fetch` of a cross-origin, no-CORS image succeeds without any `host_permissions` entry or runtime prompt (found in M8, §6.2.2 fallback; SPEC §4.3 item 16). Firefox 156 behaves the same for the background page (verified in M10, checklist F9).
- MediaPipe Tasks Vision runs in a module Worker only with `FilesetResolver.forVisionTasks(base, true)` (the ES-module loader `vision_wasm_module_internal.*`); the classic loader needs `importScripts`. `scripts/copy-runtime-assets.ts` (renamed from `copy-ort-assets.ts`) bundles it into `public/mediapipe/`.
- MediaPipe Tasks Vision POSTs usage metrics to `odml.pa.googleapis.com/v1/log` every 60 s, with no opt-out (documented in its README's Privacy Notice). Every model Worker must `import '../workerEgressGuard'` as its **first** import. The guard lets network APIs reach only the extension's own origin, and refused attempts are logged as `egress_blocked` (SPEC §9.5).
- Tesseract.js runs its own **classic** Worker (`workerPath`) and loads the core with `importScripts`. Emscripten looks for the core's `.wasm` next to the *worker* script, and Tesseract passes no `locateFile`. `src/models/providers/ocr/workerBootstrap.ts` (bundled by Vite as a classic IIFE worker via `?worker&url`) imports the egress guard, pre-loads the core from `public/tesseract/`, and wraps `TesseractCore` with a `locateFile`. Tesseract then skips its own core loading.
- zxing-wasm fetches its `.wasm` from jsDelivr by default. The QR worker overrides `locateFile` to `public/zxing/zxing_reader.wasm`.
- The §6.2.2 fetch fallback refuses private and intranet hosts (`src/image/privateHost.ts`), including 127.0.0.1, which the e2e servers listen on. `tests/e2e/fixtures.ts` maps `xo.edward.test` to 127.0.0.1 with `--host-resolver-rules` so the fallback path can still be tested.
- In Chromium's offscreen document, `OffscreenCanvas.convertToBlob()` runs as an idle task with a 1 s fallback deadline, and the hidden document is never idle. Every call takes about 1000 ms. Encode in a Worker (`src/image/jpegEncoder.ts`). Never give a library an OffscreenCanvas it will encode itself: Tesseract.js does exactly that, so the OCR provider hands it BMP bytes (`providers/ocr/bmp.ts`).
- Firefox 156 grants `<all_urls>` content-script access at install (M10, `web-ext`/temporary install), but the user can turn it off in `about:addons`, after which Start must request it again. `permissions.request()` only prompts when it's called before any `await` in a click handler. Popup Start calls `platform.ensureSiteAccess()` first. On Chromium that method only checks (`permissions.contains`). With access turned off, Firefox 156 still showed no prompt: clicking the toolbar button seems to grant per-tab access (likely `activeTab`), so the popup's refusal message can't be reached there (M10, checklist F3).
- Firefox stops an idle MV3 event page after ~30 s, taking its model workers with it. MediaPipe's 60 s metrics timer never fires in a short session, so `egress_blocked` rows only show up if the page is kept busy past 60 s (checklist F10). Warm start reruns on every wake.
- WebGPU in Chrome on Linux needs `--enable-unsafe-webgpu --enable-features=Vulkan` for a real adapter. `--enable-unsafe-webgpu` alone gives SwiftShader, a CPU emulator that detection would count as a GPU.
- Firefox resolves test names to localhost with the pref `network.dns.localDomains=xo.edward.test`, its counterpart to Chromium's `--host-resolver-rules` (docs/BROWSER_CHECKLIST.md).
- Under Playwright, `chrome.runtime.reload()` from the service worker closes the whole browser, even with a tab open. A test that needs a setting in place when the compute host starts (e.g. the model override) writes storage, closes the context and relaunches on the same profile: `launchExtensionContext(userDataDir)` in `tests/e2e/fixtures.ts`.
