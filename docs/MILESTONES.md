# Edward — Milestones

Solo build plan. Claude Code works on **one milestone at a time**, driven by the `/milestone`, `/milestone-check`, `/milestone-quiz` and `/milestone-done` skills.

Rules:
- Only the milestone marked `in progress` may be worked on.
- Anything a milestone needs from a later one is stubbed behind its interface and noted under "Notes for next milestone".
- A milestone is `done` only when every "Done when" item is true and `/milestone-check` passes.
- Deviations from `docs/SPEC.md` are recorded in the Log below (and browser quirks also in SPEC §4.3 and CLAUDE.md).

Status values: `todo` · `in progress` · `done` · `cut`

---

## M1 — Scaffold · `done`
**Spec:** §4, §17, §20 · **Estimate:** ½ day

Deliverables:
- WXT + TypeScript + npm project targeting Chrome and Firefox. Entrypoints: background, content, offscreen (Chromium only), popup, settings — empty stubs.
- Manifest per §4: correct background type per browser (inspect the generated manifests), CSP with `'wasm-unsafe-eval'` for extension pages, `host_permissions` for `api.groq.com`, `optional_host_permissions` for `https://*/*`.
- `tsconfig` strict + `noUncheckedIndexedAccess`.
- ESLint with the boundary rules from CLAUDE.md.
- Vitest; Playwright configured to load the unpacked Chromium build.
- §17 folder layout with `index.ts` stubs.
- npm scripts matching CLAUDE.md (update CLAUDE.md if they differ).

Done when:
- [x] `npm run dev` loads in Chrome; `npm run dev:firefox` loads in Firefox
- [x] `npm run check` passes
- [x] A deliberate boundary violation (e.g. `browser` used in `src/dom/`) fails lint

## M2 — Contracts only · `done`
**Spec:** §4.2, §5, §7.5, §7.6, §9.2–9.3, §10, §11.1, §12.1–12.2, §13.1 · **Estimate:** ½ day

Types, interfaces and type guards only — no implementations:
- `src/models/capabilities.ts`, `src/models/provider.ts`
- `src/backend/types.ts` (AgentBackend, SanitizedObservation, BackendCapabilities)
- `src/backend/llm/types.ts` (ModelClient, ModelRequest, ModelResponse, TextContent, ImageContent)
- `src/agent/schema.ts` (Action, AgentResponse, ActionResult) + hand-written type guard + unit tests
- `src/logging/schema.ts` (LogRecord, SessionRecord, OpName, Outcome, ReasonCode)
- `src/platform/types.ts` (Platform, Transport) + `src/platform/messages.ts` (typed MessageMap)
- `src/dom/types.ts` (SkeletonNode, SanitizedNode, ContentUnit, context hints)
- `src/sanitize/types.ts` (PiiType, TokenMapEntry)
- `src/hw/types.ts` (DeviceProfile)

Done when:
- [x] Every file above exists and compiles
- [x] Type-guard tests pass
- [x] I can explain every type (`/milestone-quiz`)
- [x] `SanitizedObservation` has no field that could carry raw content; `LogRecord` has no free-text field
- [x] Ambiguities found are listed in the Log and resolved

After M2, contract files change only deliberately, with a Log entry.

## M3 — Infrastructure · `todo`
**Spec:** §4, §10, §11 · **Estimate:** 1 day

- Logger: `logger.timed()`, ring buffer, periodic IndexedDB flush, JSON/CSV export, aggregator (p50/p95 per op, cache hit rate, fail-closed count). Unit tests.
- Hardware detection, logged as the SessionRecord.
- Platform layer: `chromium.ts`, `gecko.ts` (`webkit.ts` stub). Transport with typed request/response and ports, incl. Chromium binary encoding (§4.3.7). `ensureComputeHost`, `requestHostPermission`, settings store.
- Compute host bootstrap (hardware detection + logger).

Done when:
- [ ] e2e: content script → compute host → content script ping round-trip passes on Chromium
- [ ] Ping works manually in Firefox
- [ ] Session record with device profile is visible in the exported log
- [ ] Measured: round-trip time for a 1 MB binary payload on Chromium (record in Log)

## M4 — Test harness · `todo`
**Spec:** §18 · **Estimate:** ½ day

- `tests/fixtures/`: synthetic-PII pages — profile, form, comments with emails, contact page with public support email, links with PII in query strings, password/OTP form, iframe, canvas, images with rendered PII text, synthetic faces, QR codes. All canaries in `tests/fixtures/canaries.json`.
- Mock `AgentBackend` registered via `getBackend()` that records every observation.
- Canary leak e2e test (§18.1) — expected to fail until M5/M9; clearly marked.
- `scripts/fetch-models.ts` downloading tier-1 weights into `public/models/` (git-ignored).

Done when:
- [ ] Fixtures load locally; canary test runs (and fails for the expected reason)
- [ ] `fetch-models` downloads all tier-1 weights

## M5 — Vertical slice 1: text pipeline · `todo`
**Spec:** §5, §7.1, §7.6, §7.8, §14 · **Estimate:** 1½ days

- Phase A + Phase B (secret fields, visibility, header/footer rule, element registry, chunked ContentUnits).
- Regex tier (tests first: Verhoeff, Luhn, UPI before email, masked Aadhaar) + URL sanitization.
- Token map (stable per session + origin). NER step is a pass-through behind `PiiNer`.
- Assembler → `SanitizedObservation` (text only) + final guard.

Done when:
- [ ] Canary test passes for all text-only fixtures
- [ ] Iframe/canvas/secret markers present in output
- [ ] Baseline latency (`dom.phase_a`, `dom.phase_b`, `sanitize.regex`) recorded in Log

## M6 — Vertical slice 2: agent loop · `todo`
**Spec:** §12, §13 · **Estimate:** 1½ days

- Backend registry, `LlmAgentBackend`, `GroqClient` (check Groq's current vision model ID first), `openaiCompatible` client, `system_prompt.txt` adapted from `reference/python-prototype/`, settings page.
- Loop, validation, egress policy (tests first — pass + fail case per rule), token resolver, executor, popup start/stop, status overlay.

Done when:
- [ ] With a real Groq key, the agent fills the fixture form using tokens
- [ ] A prompt-injected fixture that tries to navigate with a token is blocked and logged
- [ ] Mock backend and Groq backend are swappable from settings with no code change

**End of vertical slice — the system works end to end from here.**

## M7 — NER + heuristics · `todo`
**Spec:** §7.2–7.5, §7.7, §9.4–9.6 · **Estimate:** 1 day

- Model registry + NER tier-1 provider (verify it loads in Transformers.js; fallback per §9.5), NER worker with micro-batching, label map.
- Public-vs-private email heuristic (tests first), context hints.
- Sanitization memo.

Done when:
- [ ] Recall on an Indian names/addresses fixture recorded in Log (switch checkpoint if poor)
- [ ] Canary test still passes; public support email kept, personal emails tokenized
- [ ] p50 `sanitize.ner` recorded, WebGPU vs WASM if available

## M8 — Images 1: acquisition, cache, faces · `todo`
**Spec:** §6.1–6.3, §6.6–6.7, §9.5–9.6 · **Estimate:** 1½ days

- Pixel acquisition (canvas → compute-host fetch → withhold), `img_id`, size floor, prioritization.
- BlazeFace tier-1 provider (check Web Worker compatibility first; fallback per §9.5), vision worker pool.
- Solid-fill redaction, downscale, cache without raw bytes (TTL + revalidation).

Done when:
- [ ] Face fixtures are redacted; unreadable images are withheld with a marker
- [ ] Second observation of the same page hits the cache (logged)
- [ ] No raw image bytes in IndexedDB (inspect)

## M9 — Images 2: OCR, QR, selection · `todo`
**Spec:** §6.4–6.5, §14.3 · **Estimate:** 1 day

- Tesseract.js provider (word boxes via `blocks: true`), OCR spans → sanitization, low-confidence rule, OCR tokens.
- zxing-wasm QR provider.
- Image selection by `backend.capabilities`, `request_limit` markers; images included in the Groq request.

Done when:
- [ ] Canary test passes for image fixtures (including OCR of outgoing images)
- [ ] Non-PII text in images stays visible
- [ ] p50/p95 per image op recorded

## M10 — Firefox + latency pass · `todo`
**Spec:** §4, §15 · **Estimate:** 1 day

- Full Firefox pass (manual checklist). Edge smoke test.
- Warm start, benchmark script over fixtures, tuning from logger numbers.

Done when:
- [ ] Observe + one action works in Chrome, Edge, Firefox
- [ ] Benchmark table (per op, WebGPU vs WASM) saved to `docs/BENCHMARKS.md`

## M11 — Extensibility demo (optional) · `todo`
**Spec:** §9.5, §12.3 · **Estimate:** ½–1 day

- SCRFD tier-2 face provider, selected automatically on GPU.
- `HttpAgentBackend` stub + mock server test + `docs/WIRE_PROTOCOL.md`.

Done when:
- [ ] Switching face tier needs only config; recall difference recorded
- [ ] Mock custom server drives one agent step

## M12 — Real sites + freeze · `todo`
**Spec:** §16, §18 · **Estimate:** 1 day

- Run on a spread of real sites; fix bugs; cut per the cut order.
- Export numbers for slides; update SPEC with final deviations.

Done when:
- [ ] Demo script rehearsed end to end
- [ ] All cuts documented in SPEC §16 and the Log

**Cut order if behind:** M11 → cache revalidation (keep TTL) → background-image support → public-email heuristic (treat all emails as private) → Firefox polish.

---

## Log

<!-- /milestone-done appends entries here: date, milestone, summary, measurements, deviations, notes for next milestone -->

### 2026-09-16 — M1 Scaffold
- Summary: WXT + TypeScript project targeting Chrome and Firefox, with background/content/offscreen/popup/settings entrypoints as empty stubs; manifest built per §4 (CSP with `wasm-unsafe-eval`, `host_permissions`/`optional_host_permissions`, per-browser background field, `offscreen` permission Chromium-only); strict `tsconfig` + `noUncheckedIndexedAccess`; ESLint boundary rules for extension APIs and model-lib/vendor-SDK imports; Vitest and Playwright configured and passing; full §17 folder layout with `index.ts` stubs.
- Measurements: Chrome prod build 6.28 kB, Firefox prod build 6.26 kB; e2e scaffold test (extension loads, service worker registers) passes headed in ~1.4–1.9s.
- Deviations from SPEC: (1) WXT's default `manifestVersion` is 3 for Chrome but 2 for Firefox — forced to 3 explicitly (SPEC §4.3 item 10). (2) The manifest does not literally declare both `background.scripts` and `background.service_worker` in one file, as §4 originally phrased it — WXT builds one manifest per target and picks the correct field from a single `defineBackground()` source, same net effect via a different mechanism (SPEC §4.3 item 11). (3) `offscreen` permission is included only in the Chromium manifest, omitted on Firefox, which has no such API (SPEC §4.3 item 12). All three are now documented in SPEC §4.3 and CLAUDE.md's "Browser quirks found".
- Noticed (out of scope): `web-ext` (required by WXT's peer deps for Firefox dev/build) pulls in `image-size` via `addons-linter`, which has 4 known high-severity DoS advisories (ICNS/JXL/HEIF infinite-loop parsers). Dev-tooling only, never shipped in the built extension; no non-breaking fix exists upstream yet (`npm audit fix --force` would downgrade `web-ext` below WXT's required `>=9.2.0`). Firefox AMO packaging will eventually need `browser_specific_settings.gecko.id` and `gecko.data_collection_permissions` (SPEC §4.3 item 13) — not needed before a packaging milestone.
- Notes for next milestone: M2 is contracts-only (types/interfaces/type guards, no implementations) — `src/platform/types.ts` (Platform, Transport) + `messages.ts`, `src/backend/types.ts`, `src/backend/llm/types.ts`, `src/agent/schema.ts` (+ type guard + tests), `src/logging/schema.ts`, `src/dom/types.ts`, `src/sanitize/types.ts`, `src/hw/types.ts`, `src/models/capabilities.ts` + `provider.ts`. Each folder's current empty `index.ts` stub should be reconsidered once its types.ts lands (either re-export from it or drop the placeholder). Two CLAUDE.md ESLint boundary rules are still deferred with nothing to enforce yet — orchestrator/assembler depending only on `AgentBackend`/`SanitizedObservation`, and consumers using `getModel()`/`getBackend()` — revisit once the registries/orchestrator exist (M3/M6).

### 2026-09-16 — M2 Contracts only
- Summary: Added the 10 contract files M2 lists — `models/capabilities.ts` + `provider.ts` (§9.2–9.3), `backend/types.ts` (§12.1), `backend/llm/types.ts` (§12.2), `agent/schema.ts` (§13.1, incl. hand-written `isAgentResponse`/`isAction` type guards), `logging/schema.ts` (§11.1), `platform/types.ts` + `messages.ts` (§4.2), `dom/types.ts` (§5.1–5.2, §7.5), `sanitize/types.ts` (§7.1–7.6), `hw/types.ts` (§10) — plus tests-first coverage for the type guard (`tests/unit/agent/schema.test.ts`, 22 cases). Every folder's `index.ts` stub became a real barrel re-export instead of `export {}`.
- Measurements: 33/33 unit tests pass (11 scaffold + 22 schema); `npm run check` (tsc strict + ESLint boundaries) clean; production build unaffected (6.28 kB, same as M1) since these are erased-at-build types plus one small runtime validator.
- Deviations from SPEC (ambiguity resolutions, none contradicting SPEC, all filling gaps the milestone's own file list implied but SPEC's prose didn't spell out mechanically):
  1. `Logger` (a `timed<T>(op, meta, fn)` interface) added to `logging/schema.ts`, not in M2's literal file list, because `models/provider.ts`'s `ModelProvider.load()` (§9.3) takes a `logger: Logger` and needs the type to exist now; the ring-buffer/IndexedDB implementation still arrives in M3.
  2. `platform/messages.ts`'s `MessageMap` is deliberately empty (`Record<never, ...>` placeholders for `request`/`port`) rather than speculatively designed — concrete message entries (ping in M3, DOM chunks in M5, actions in M6, images in M8) get added directly to this file as each milestone needs them, not merged in via a generic mechanism.
  3. `dom/types.ts` splits `SkeletonNode` (Phase A: structural fields + a `pending_content: ContentField[]` pointer list) from `SanitizedNode` (Phase A shape + a `content` map merged in from Phase B), since §5.1 says Phase A "reads no text, runs no sanitization" while its own field table lists content fields Phase A must still reference. Also added `ExclusionMarker` (`iframe_skipped`, `shadow_closed_skipped`, `canvas_skipped`, `svg_skipped`, `video_skipped`) and `ImageOmittedReason` (`unreadable`, `detector_failed`, `request_limit`) as typed fields on `SkeletonNode`/`SanitizedNode`, using the literal marker strings already named in SPEC §5.1/§6.1/§14.3, so "every exclusion leaves a marker" (§2.10) has a place to land at the type level.
  4. `isAgentResponse` (§13.1) enforces the numeric caps (`actions.length <= 3`, `thought.length <= 200`, `wait.ms <= 3000`) as validation failures rather than treating them as advisory/clamped-later — an over-cap response is `invalid`, which will drive the LLM backend's one-retry-then-fail path (§12.2) once M6 exists. Token-content semantics (e.g. §13.4's "tokens forbidden in `navigate.url`") are explicitly *not* checked here — that's a separate policy pass that needs the token map, which doesn't exist until resolution time.
- Noticed (out of scope): none found in-code during this milestone.
- Notes for next milestone: M3 (Infrastructure) implements the real `Logger` behind the type-level contract added here, and `chromium.ts`/`gecko.ts` against `Platform`/`Transport`, adding the first concrete `MessageMap` entries (starting with `ping`) directly to `platform/messages.ts`. Separately (post-`/milestone-check` design discussion, not yet acted on): for the eventual M10 benchmark table / "resource utilization" story, we decided *against* capturing exact CPU/GPU model (e.g. Chromium's privileged `chrome.system.cpu` API) — it's Chromium-only, needs an extra permission, and cuts against the extension's minimal-footprint pitch. `DeviceProfile`'s existing structural fields (`gpu.available`, `compute`, `hardwareConcurrency`, `deviceMemoryGB`) are sufficient to distinguish performance regimes (e.g. GPU+16-core vs. WASM+4-core); a human-readable machine label ("workstation" vs. "low-end laptop") should be an operator-supplied argument to the M10 benchmark script, not a field on `SessionRecord`/`LogRecord`. Also flagged as worth reconsidering when M3's Logger is implemented (nothing added to the schema yet, revisit only if the M9/M10 latency story needs it): worker-pool occupancy / queue-wait metrics tied to §9.6's bounded pools, an optional Chromium-only JS-heap snapshot (`performance.memory`), and Long-Tasks-API-based main-thread-responsiveness counts.
