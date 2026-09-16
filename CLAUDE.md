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
