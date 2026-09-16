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

## Workflow
- Use plan mode for each milestone. Plans cite spec sections. Wait for approval before editing.
- Tests first for: regex tier (Verhoeff, Luhn), token map, egress policy, public-email heuristic, response validation.
- Run `npm run check && npm test` before saying a milestone is done.
- Fixtures use synthetic PII only. Never commit API keys.
- Model weights are not committed; `scripts/fetch-models.ts` downloads them into `public/models/`.

## Browser quirks found
<!-- Append here AND to SPEC §4.3 whenever one is discovered -->
