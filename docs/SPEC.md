# Edward — Build Specification (v2.2)
### SIH26171 · On-device Visual Perception for Light-weight Browser Agents (ISRO)

This document is the authoritative spec for building this system: architecture, data contracts, and design philosophy. Where it is silent on a detail, prefer the design philosophy (§2) over convenience.

A Python reference prototype (originally also called `edward`; kept in `reference/python-prototype/` to avoid confusion with this project's name) demonstrates the client-abstraction pattern required for §12. In this spec it is called **the Python prototype**. It is a **pattern reference only**; the system itself is written entirely in TypeScript (§2.14).

*Name:* the project is called **Edward**, after Edward Snowden (renamed from PrivyVision in v2.2).

---

## 0. What changed in v2 (decision log)

| # | Decision | Where |
|---|---|---|
| D1 | Backend-agnostic. The "server" is whatever reasoning backend is configured — an LLM vendor (Groq, Anthropic, OpenAI, …) or a custom server later. The extension only sends a sanitized observation and receives actions. No Python/relay server is part of the build. | §1, §12 |
| D2 | TypeScript everywhere (strict mode). JavaScript only for third-party runtime files that ship as JS/WASM. | §2.14, §17 |
| D3 | Browser-agnostic core + one small, documented browser-dependent layer (`src/platform/`). Targets Chrome, Edge, Firefox; Safari best-effort. | §4 |
| D4 | On-device models are source-agnostic: consumers ask for a *capability* (face, OCR, NER, QR), never a library. | §9 |
| D5 | Groq (via the generic LLM backend) is the demo backend. Backend limits (e.g. max images per request) are exposed as *capabilities*, so swapping backends needs no assembler changes. | §12 |
| D6 | Logger records metrics only (operation, timings, device, outcome codes) — never content. | §11 |
| D7 | Minimal action framework — scoring weight is on redaction and latency, not agent sophistication. | §13 |
| D8 | Token resolution has an egress policy so real values can't be exfiltrated through actions. | §13.4 |
| D9 | Raw image bytes are never persisted. The cache stores hashes, validators, detections and the *redacted* image only. | §6.6 |
| D10 | Tier 3 (LLM disambiguation) is cut. Ambiguous spans are redacted (fail-closed). | §7.3 |
| D11 | Secret fields (passwords, OTP, card fields) are never read. | §5.1 |
| D12 | Latency is a first-class requirement with its own section. | §15 |
| D13 | (v2.1) Two-layer backend design: `AgentBackend` (observation → actions) over either the generic LLM backend (`ModelClient`, Python-prototype pattern) or a custom server via a versioned wire protocol. | §12 |

---

## 1. Problem framing

We are building a browser extension that acts as a **privacy firewall** for a browser-automation agent. A remote reasoning backend (typically an LLM) needs to perceive and act on a live webpage (DOM + visual content), but the page may contain PII (text, images, forms) that must never leave the device unredacted.

The extension: extracts a sanitized representation of the current page (DOM structure + redacted images), sends *only* that to the configured reasoning backend, receives an action list, and executes those actions on the real page — resolving tokenized placeholders back to real values on-device, under an egress policy.

The reasoning backend is pluggable: an LLM vendor API today (Groq for the demo), possibly a custom server later. The extension's only network egress is (a) the backend call carrying the sanitized observation and (b) image re-fetches for pixel acquisition/cache validation (§6.2).

**Core commitment**: perception, PII detection and redaction happen locally. Raw PII never crosses the network boundary — neither to the reasoning backend (whoever runs it), nor to third parties via executed actions.

---

## 2. Design philosophy (binding on every subsystem)

1. **Fail-closed on ambiguity.** When a detector is uncertain, redact. Over-redaction is acceptable; missed PII is not. Applies at every threshold, and to every failure (model error, timeout, unreadable image → item is withheld or redacted, never passed through as "clean").
2. **Tokenize, don't just delete.** PII is replaced with a stable placeholder (`[PII_EMAIL_1]`). Real values live only in the local resolution map, which is never serialized to anything that leaves the device.
3. **Source-agnostic on-device models.** Every ML/detection component sits behind a capability interface. Consumers never import a model library, never know which library or method provides the model, and never see raw confidence floats (§8, §9).
4. **Backend-agnostic reasoning.** The extension depends only on "sanitized observation in, actions out". Adding an LLM vendor or a custom server must never require editing anything outside that backend's own file(s) plus a config entry (§12).
5. **Per-unit processing, never whole-document payloads.** Never concatenate a page's text (or several nodes' text) into one model input. Work is dispatched per node / per image into a bounded pool. *Clarification:* micro-batching several **independent** sequences into one inference call (a batch tensor, each sequence kept separate, outputs mapped back per sequence) is allowed and encouraged for latency — it is not concatenation.
6. **Structure first, content second, as a coupled pipeline.** A fast structural pass builds the skeleton (no content read); node content is fanned out to sanitization concurrently and merged back by `node_id`.
7. **No raw PII persistence.** Raw DOM text is discarded as soon as its sanitized version exists. It is never written to disk, never logged. The only in-memory reuse permitted is §7.7 (keyed by a per-session HMAC, memory-only).
8. **No raw image persistence either (changed in v2).** Raw image bytes are held in memory only while being processed. The cache stores hashes, HTTP validators, detection results and the redacted image (§6.6).
9. **Rule-based over model-based when a rule is legible and sufficient** (e.g. public-vs-private email heuristic, §7.5).
10. **Boundary exclusions are explicit.** Iframes, canvas, inline SVG, unreadable images, secret fields: leave a marker in the output, never silently omit.
11. **Everything observable is logged — as metrics, never content** (§11).
12. **Browser-agnostic by construction.** Only `src/platform/` may touch extension/browser-specific APIs. Everything else is plain TypeScript against web-standard APIs (§4).
13. **Latency is a feature.** Every design choice is weighed for latency second only to privacy (§15).
14. **TypeScript only.** Strict mode. JavaScript only where TypeScript cannot be used (vendored third-party worker/WASM glue files).
15. **Least egress for actions.** A resolved real value may only be written into the page it came from, into a form field — never into a URL, never to a different origin (§13.4).

---

## 3. System architecture overview

```
┌─────────────────────────── Browser Extension ───────────────────────────────┐
│                                                                              │
│  CONTENT SCRIPT (per tab)            COMPUTE HOST (1 per browser session)    │
│  ┌───────────────────────┐          ┌──────────────────────────────────────┐ │
│  │ DOM Extractor          │  raw     │ Orchestrator (agent loop, §13)       │ │
│  │  Phase A: skeleton     │  text &  │                                      │ │
│  │  Phase B: content units├─────────▶│ Sanitization pool (§7)               │ │
│  │ Element Registry       │  pixels  │   Regex → NER (micro-batched)        │ │
│  │ Pixel reader (canvas)  │ (local   │ Image pipeline (§6)                  │ │
│  │ Action Executor (§13)  │ messages)│   Face / OCR / QR → redact           │ │
│  │ Status overlay         │◀─────────┤   Image cache (IndexedDB, no raw)    │ │
│  └───────────────────────┘ resolved  │ Context Assembler (§14)              │ │
│                             actions  │ Token Map + Token Resolver (§7.6,13) │ │
│                                      │ Model Registry (§9) · HW detect (§10)│ │
│                                      │ Backend Registry (§12)               │ │
│                                      │ Logger (§11)                         │ │
│                                      └───────────────┬──────────────────────┘ │
│  BACKGROUND (router only; browser-specific lifecycle, §4)                    │
│  PLATFORM LAYER src/platform/* — the only browser-dependent code             │
└──────────────────────────────────────────────────┼───────────────────────────┘
                                                   │ SanitizedObservation (DOM JSON + redacted images)
                                                   ▼
                       Reasoning backend: LLM vendor (Groq first) | custom server
                                                   │ AgentResponse (actions; may reference [PII_*])
                                                   ▼
                     Policy check → Token Resolver → Action Executor (content script)
```

All arrows inside the extension box are extension-internal messaging and stay on-device; they are inside the trust boundary. Raw content carried on them is never logged.

---

## 4. Runtime contexts and the browser-dependent layer

### 4.1 Why a platform layer is needed

The browsers differ in where heavy compute can run:

| | Chrome / Edge | Firefox | Safari |
|---|---|---|---|
| MV3 background type | Service worker only (no DOM, no Web Workers, killed after ~30 s idle) | Event page (`background.scripts`, has DOM) | Event page by default (`background.scripts`); service worker optional |
| Offscreen documents API | Yes | No | No |
| Where the **compute host** runs | Offscreen document (reason `WORKERS`), created on demand | The background event page itself | The background event page itself |
| API namespace | `chrome.*` | `browser.*` | `browser.*` |
| WebGPU (web content) | Win/macOS/ChromeOS; Linux only on some GPUs | Win (141+), macOS (147+); Linux not yet | Safari 26+ |
| Packaging | zip | zip (AMO) | Xcode conversion + Mac App Store |

The manifest declares **both** `background.scripts` and `background.service_worker` (same entry file). Chrome uses the service worker; Firefox and Safari use the event page. WebGPU availability inside extension contexts is not guaranteed anywhere, so the WASM path (§10) is always required.

### 4.2 What lives in `src/platform/`

`src/platform/` exports one interface, `Platform`, with one implementation per browser family (`chromium.ts`, `gecko.ts`, `webkit.ts`), selected at build time by the build tool's target flag. Nothing outside `src/platform/` may import `browser`/`chrome` globals or the extension-API package — enforced with an ESLint `no-restricted-imports` / `no-restricted-globals` rule.

```ts
interface Platform {
  readonly name: 'chromium' | 'gecko' | 'webkit';
  // Messaging between content script, background, compute host
  transport: Transport;                 // request/response + long-lived ports, typed by MessageMap
  // Compute host lifecycle
  ensureComputeHost(): Promise<void>;   // chromium: create offscreen doc if absent; gecko/webkit: no-op
  // Storage (settings only; never content)
  settings: KeyValueStore;              // wraps storage.local
  // Tabs
  getActiveTab(): Promise<TabRef>;      // {tabId, url}
  sendToTab<M>(tabId: number, msg: M): Promise<unknown>;
  captureVisibleTab?(tabId: number): Promise<Blob>;   // optional fallback, rate-limited
  // Permissions
  requestHostPermission(origin: string): Promise<boolean>; // for custom backend endpoints (§12.4)
  // Assets bundled with the extension
  assetUrl(path: string): string;       // runtime.getURL
  // UI
  openSettings(): Promise<void>;
}
```

Everything else — DOM extraction, sanitization, image pipeline, model registry, reasoning backends, logger, orchestrator — is platform-free TypeScript using only web-standard APIs (`fetch`, `IndexedDB`, `Web Workers`, `OffscreenCanvas`, `crypto.subtle`, `navigator.gpu`).

### 4.3 Documented browser differences the platform layer absorbs

1. **Compute host placement** (table above). On Chromium, messages to the compute host go content script → background → offscreen document (the offscreen document cannot call `tabs` APIs, so tab-bound messages are routed back through the background).
2. **Namespace/promises** — use the build tool's unified `browser` export inside `src/platform/` only.
3. **CSP** — `content_security_policy.extension_pages` must include `'wasm-unsafe-eval'` (needed by ONNX Runtime, Tesseract, zxing). No remote code: all worker scripts and `.wasm` files are bundled and their paths configured explicitly (Transformers.js/ONNX Runtime and Tesseract.js default to CDN URLs — override them).
4. **Model weights** — tier-1 weights are bundled in the extension (offline demo, no first-run download). Tier-2 weights may be downloaded on demand and stored with the Cache API.
5. **UI surface** — the popup closes on blur in every browser, so it only starts/stops a task. Live status is shown by a content-script overlay (closed shadow root, excluded from extraction) — identical on all browsers. No `sidePanel` (Chromium-only) or `sidebar_action` (Firefox-only).
6. **Safari** — built from the same source; packaging via Xcode is documented but not part of the demo path.
7. **Binary payloads over messaging** — Chromium extension messaging has historically been JSON-serialized (no `ArrayBuffer`/`ImageBitmap`), while Firefox/Safari use structured clone. `Transport` hides this: on Chromium it encodes pixel payloads as lossless PNG → base64 (unless structured clone is confirmed on the target Chrome version); elsewhere it passes buffers through. Consumers always send/receive `ArrayBuffer`.
8. **Host permissions** — Firefox lets users withhold host permissions granted in the manifest, and custom backend origins are requested at runtime everywhere. The platform layer checks permissions at startup and asks for any that are missing (`requestHostPermission`); without them the agent does not start.
9. **Compute host lifetime** — the Chromium offscreen document lives until closed. Firefox/Safari event pages can be unloaded when idle. During an agent session the content script keeps a `runtime.connect` port open with a periodic ping. If the host restarts anyway, the session is aborted (token map is lost with it, so nothing leaks) and models reload on the next start.

### 4.4 Supported-browser test matrix (for the demo)

Chrome (primary), Edge (Chromium build, smoke test), Firefox (smoke test). Safari: build only, if time permits.

---

## 5. DOM extraction pipeline (content script)

### 5.1 Phase A — structural skeleton (fast, content-free)

Walk the live DOM, including **open** shadow roots, **excluding all iframe content** (an `iframe_skipped` marker node is emitted instead). Closed shadow roots are unreachable and get a `shadow_closed_skipped` marker. For every kept node, capture:

| Field | Notes |
|---|---|
| `node_id` | Short generated ID (`n123`). Registered in the **Element Registry** (§5.6). |
| `tag` | Element tag name. |
| `node_type` | `element` or `text`. |
| `parent_id` | Parent's `node_id`. |
| `role` | Native semantics + explicit ARIA role. |
| `accessible_name` | Resolve `aria-labelledby`, `label[for]`, wrapping `<label>`, `alt`, `title`. Treated as **content** — goes through Phase B. |
| `bbox` | `{x, y, w, h}` from `getBoundingClientRect()`, rounded to integers. |
| `visible` | `true`/`false` per §5.3. |
| `in_viewport` | Whether `bbox` intersects the viewport. |
| `state` | `{disabled, checked, selected, readonly, required, expanded}` — only keys that apply. |
| `scroll_parent` | `node_id` of nearest scrollable ancestor, if any. |
| `attrs` | Whitelist only: `href`, `src`, `type`, `placeholder`, `name`. `href`/`src`/`placeholder` are **content** (Phase B). `src` of `data:`/`blob:` is replaced by `"[inline-data]"`. |
| `flags` | Semantic class flags from a small whitelist (`error`, `disabled`, `active`, `hidden`); never raw class strings. |
| `secret` | `true` for secret fields (below). |

**Secret fields (never read):** `input[type=password]`; `autocomplete` values `one-time-code`, `current-password`, `new-password`, `cc-number`, `cc-csc`, `cc-exp*`; inputs whose name/id matches `/otp|cvv|cvc|pin/i`. Their `value` is never accessed; output is `value: "[SECRET]"`. Secrets are **not** tokenized, so the agent can never have them typed anywhere.

Page-level metadata (not in the node tree): sanitized `title`, sanitized URL (§7.8), viewport size, scroll position.

Phase A reads no text and runs no sanitization.

### 5.2 Phase B — content fan-out

Each piece of content — text node value, input `value` (non-secret), `placeholder`, `accessible_name` when derived from text, `href`, `src` — becomes an independent **ContentUnit** `{unit_id, node_id, field, text}`. Units are sent to the compute host in chunks (e.g. 200 units per message) for per-unit sanitization (§7). Results are merged back by `(node_id, field)`. Raw text is dropped from content-script memory once the chunk is sent.

Text node values longer than a cap (e.g. 2,000 characters) are split into overlapping windows (e.g. 50-character overlap) before sanitization so no unit exceeds the NER model's sequence length. Windows are still one node's text — never mixed with other nodes.

### 5.3 Visibility rules

- **Strip entirely** (no marker): nodes that are `display:none`/`visibility:hidden`/zero-size/off-document **and** have no interactive descendant **and** are not the target of a live toggle (`aria-controls`, `<details>`, `aria-expanded` owner). Also strip `<script>`, `<style>`, `<noscript>`, `<template>`, and all of `<head>` except `<title>`.
- **Keep with `visible: false`**: collapsed accordions/menus/modals with a live toggle, ARIA-live regions, visually-hidden text attached to a labelled control.
- Hidden-but-kept content is not queued for image processing (§6.7).

### 5.4 Header/footer handling (simplified in v2)

Inside `<header>`, `<footer>`, `role=banner`, `role=contentinfo` (and the top-level `<nav>`): keep interactive elements (links, buttons, inputs, menu toggles) and their accessible names; drop non-interactive text and decorative images. The "repeated across pages" detection from v1 is cut (needs cross-page memory; low value for the time).

### 5.5 Class handling

No raw `class` values. Only the whitelisted semantic flags in §5.1.

### 5.6 Element Registry (replaces DOM attribute injection)

The content script keeps `Map<node_id, WeakRef<Element>>`. Actions resolve `node_id` through this map; no attribute is written into the page (no page mutation, no interference with frameworks, shadow roots need no re-entry logic). The registry is rebuilt on each observation. A stale or collected reference → the action fails with `stale_node` and the step ends (§13.3).

### 5.7 Concurrency

Phase A runs on the main thread in time-sliced chunks (yield every ~8 ms via `scheduler.yield()` when available, else `setTimeout(0)`) so the page stays responsive. All heavy work runs in the compute host.

---

## 6. Image pipeline (compute host, pixels read in content script)

### 6.1 Scope

- `<img>` (including `srcset`/`<picture>` — use `currentSrc`)
- CSS `background-image` (`url(...)` only; gradients ignored)

Out of scope, with markers: `<canvas>` (`canvas_skipped`), inline `<svg>` (`svg_skipped`), `<video>` (`video_skipped`), images inside iframes (covered by `iframe_skipped`).

**Size floor:** images whose rendered size is below 32×32 px are **not sent** to the LLM (`image_omitted: "too_small"`). They are too small to be useful to the agent, and skipping them avoids processing avatars/icons that could contain faces (fail-closed and faster).

### 6.2 Pixel acquisition

1. **Canvas read in the content script**: draw the rendered image to an `OffscreenCanvas`, `getImageData`. Transfer the pixels (`ImageBitmap`/`ArrayBuffer`) to the compute host. No network cost.
2. **Fallback — fetch in the compute host** (not the content script, whose `fetch` is bound by the page's CORS). The extension's host permissions allow the fetch. The response is decoded with `createImageBitmap`.
3. **If both fail** (network error, unsupported format, decode failure): the image is withheld — `image_omitted: "unreadable"`. Never sent unprocessed.
4. Optional fallback (platform, rate-limited): crop from `captureVisibleTab` for in-viewport images. Build only if 1–2 prove insufficient on test sites.

### 6.3 `img_id`

`img_id = sha256(currentSrc + "|" + naturalWidth + "x" + naturalHeight)` (truncated). For `data:`/`blob:` URLs the ID is derived from the pixel hash instead and the image is **not** cached (always processed fresh) — comment this in code.

### 6.4 Per-image processing

For each image in the pool:

1. **Face detection** → boxes with bucketed confidence. Every returned box is redacted, whatever its bucket (fail-closed); providers return candidates down to a low minimum score.
2. **OCR** → word-level spans with boxes.
3. **QR/barcode detection** → boxes. All detected codes are redacted (content classification out of scope).
4. **OCR spans → sanitization pipeline** (§7) per line. Only PII-flagged words are redacted; non-PII text stays visible for the agent. Additionally, `low`-confidence words containing `@` or 4+ digits are redacted even without a PII match (garbled OCR can hide an ID).
5. **Redaction = solid fill** (opaque rectangle, padded by 10% of box size). No blur or pixelation — both can sometimes be reversed.
6. **Any detector failure** → image withheld (`image_omitted: "detector_failed"`), per §2.1.
7. Output: redacted image (JPEG/WebP), downscaled so the longest side ≤ 1024 px, plus per-image metadata `{img_id, node_id, redactions: {faces, text, codes}}` (counts only).

### 6.5 Tokens for OCR PII

OCR PII gets tokens in the same token map (§7.6) with source `{img_id, bbox}`. The redacted box can be labelled with the token text in the image so the agent can refer to it.

### 6.6 Cache (changed in v2 — no raw bytes)

- Store: IndexedDB in the compute host (extension origin).
- Key: `img_id` + `detector_set_version` (changes whenever the active model tiers change, so a stronger model is never skipped because of an old cached result).
- Record: `{img_id, raw_sha256, etag?, last_modified?, redacted_image, redaction_counts, created_at, validated_at}`. **No raw bytes.**
- TTL: 30 minutes from `validated_at`.
- On hit within TTL → use `redacted_image` directly.
- On hit past TTL → revalidate: conditional request (`If-None-Match`/`If-Modified-Since`) first; `304` → bump `validated_at`. If no validators or `200` → hash the new bytes; same `raw_sha256` → bump `validated_at` without re-running models; different → reprocess.
- Canvas-acquired images have no validators; revalidation re-reads pixels via canvas and compares hashes.

### 6.7 Prioritization

Queue order: in-viewport images first (largest area first), then near-viewport (within one viewport height), then the rest. Images inside `visible: false` containers are not queued. The assembler (§14) waits only for images it will actually send.

---

## 7. Sanitization pipeline (shared by DOM text and OCR text)

Both sources run the same code path: **Regex → NER → decision → tokenization**.

### 7.1 Tier 1 — Regex (deterministic)

| Type | Rule |
|---|---|
| Email | RFC-lite pattern. |
| UPI ID | `handle@psp` where the PSP handle has no dot (e.g. `@okaxis`, `@ybl`, `@paytm`); checked before email so it isn't missed. |
| Phone (India-aware) | `+91`/`0` prefixes, 10 digits starting 6–9, common separators; plus generic international E.164. |
| Aadhaar | 12 digits, first digit 2–9, optional space/hyphen groups of 4, **Verhoeff** checksum. Masked forms (`XXXX XXXX 1234`) are also redacted. |
| PAN | `[A-Z]{5}[0-9]{4}[A-Z]`, 4th character in the valid holder-type set. |
| Card number | 13–19 digits with separators, **Luhn** check. |
| IFSC | `[A-Z]{4}0[A-Z0-9]{6}`. |
| Optional if time | Passport (`[A-PR-WY][1-9]\d{6}`), voter ID (EPIC, `[A-Z]{3}\d{7}`), GSTIN, vehicle registration, dates of birth near "DOB". |

Regex matches are high-confidence; checksum-failing numeric look-alikes fall through to NER rather than being dropped.

### 7.2 Tier 2 — NER (sequence labelling)

Runs on each unit's text (after regex spans are masked out). Uses the `PiiNer` capability (§9). Output spans are mapped from the model's labels onto the internal `PiiType` enum by a per-provider label map (e.g. `ORG` → not PII; `LOCATION` → `ADDRESS`; unknown label → treated as PII).

Micro-batching (§2.5): the NER worker collects up to *B* units or waits up to *T* ms (e.g. B = 16, T = 10 ms), runs one batched inference, and returns results per unit.

### 7.3 Tier 3 — cut (decision D10)

No LLM disambiguation. NER spans with `low`/`medium` bucket are redacted (fail-closed). This is a design decision, not a missing feature — say so in code and in the presentation. Any future Tier 3 must run **on-device**; sending ambiguous spans to the reasoning backend would violate §1.

### 7.4 Decision rule

A span is PII if: regex match, **or** NER span of any bucket, **unless** the public-contact heuristic (§7.5) marks it public with high score.

### 7.5 Public-vs-private email heuristic (rule-based)

Weighted score (document the weights in code):

- +3 role local-part (`support`, `info`, `contact`, `sales`, `help`, `noreply`, `no-reply`, `admin`, `care`, `hr`, `careers`)
- +3 domain equals or is a subdomain of the page's registrable domain
- −4 free-mail domain (gmail, yahoo, outlook, hotmail, proton, icloud, rediffmail)
- +2 inside `schema.org` `ContactPoint`/`Organization` markup, or a `mailto:` in a landmark, or under a heading matching /contact|support|help/i
- −3 inside a comment/review/forum-post/profile block (`itemtype` Review/Comment, `article` in a list of user posts, class flag heuristics)

Public if score ≥ 4; otherwise private (redact). Public emails are kept as-is and not tokenized.

The heuristic needs node context, which the compute host doesn't have. The content script therefore attaches a small **context hint** to each ContentUnit: `{in_landmark, near_contact_heading, in_contact_markup, in_ugc_block}` (booleans computed in Phase A, no content).

### 7.6 Tokenization and the token map

- Token format: `[PII_<TYPE>_<n>]`.
- **Stable per session and origin**: the same `(origin, type, normalized value)` always gets the same token for the whole agent session, so `[PII_EMAIL_1]` means the same thing on step 1 and step 7.
- Token map entry: `{token, type, value, origin, sources: [{node_id, field, offset} | {img_id, bbox}], created_at}`.
- Lives in compute host memory only. Never persisted, never logged, never placed in a `SanitizedObservation`. Cleared when the agent session ends or the tab closes.

### 7.7 Sanitization memo (latency)

Multi-step sessions re-observe mostly unchanged pages. The compute host keeps an in-memory `Map<HMAC(sessionKey, text), SanitizedResult>` where `sessionKey` is a random key generated with `crypto.subtle` per session and never persisted. A memo hit skips regex and NER entirely. Cleared with the session. This does not violate §2.7: raw text isn't stored, and the keys can't be reversed without the in-memory key.

### 7.8 URL sanitization

Applied to the page URL and every `href`/`src`:

- Keep scheme, host, and path; sanitize each path segment and each query **value** through §7.1–7.4.
- Also redact values of sensitive query keys regardless of content (`token`, `auth`, `session`, `sid`, `key`, `code`, `email`, `phone`, `user`, `uid`, `id` when long).
- Drop the fragment unless it's a short in-page anchor (`#section-name`).

---

## 8. Confidence normalization

1. Each provider maps its own raw score to `low | medium | high`. Thresholds are per model and documented in that provider's file.
2. Consumers only see buckets.
3. Fail-closed operates on buckets, never raw floats:
   - Face / QR: every returned box is redacted regardless of bucket; buckets are logged for tuning.
   - NER: any span, any bucket, is PII (§7.4).
   - OCR: `low` words get the extra rule in §6.4.
4. Default thresholds are set low (favoring recall) and tuned on the fixture set (§18).

---

## 9. On-device model abstraction (source-agnostic)

### 9.1 Principle

Consumers ask the **Model Registry** for a capability and receive an object implementing that capability's interface. They never know whether it's backed by ONNX Runtime, Transformers.js, MediaPipe, Tesseract.js, a WASM library, or a native browser API. The capability interfaces and the registry are the deliverable; providers are plug-ins.

### 9.2 Capability interfaces (`src/models/capabilities.ts`)

```ts
type Bucket = 'low' | 'medium' | 'high';
type Box = { x: number; y: number; w: number; h: number };      // image pixels
type ImageInput = { bitmap: ImageBitmap } | { data: ImageData };

interface FaceDetector { detect(img: ImageInput): Promise<{ box: Box; confidence: Bucket }[]> }
interface OcrEngine    { read(img: ImageInput): Promise<{ text: string; box: Box; line: number; confidence: Bucket }[]> } // word-level
interface QrDetector   { detect(img: ImageInput): Promise<{ box: Box; confidence: Bucket }[]> }
interface PiiNer       { tag(texts: string[]): Promise<{ start: number; end: number; label: string; confidence: Bucket }[][]> } // one result list per input text

type Capability = 'face' | 'ocr' | 'qr' | 'ner';
```

### 9.3 Provider contract (`src/models/provider.ts`)

```ts
interface ModelProvider<C extends Capability> {
  id: string;                          // e.g. 'face/blazeface-mediapipe'
  capability: C;
  tier: 1 | 2;                         // 1 = light, 2 = strong
  requires: { webgpu?: boolean; minMemoryGB?: number };
  approxDownloadMB: number;
  load(ctx: { compute: 'webgpu' | 'wasm'; assetUrl: (p: string) => string; logger: Logger }): Promise<CapabilityImpl<C>>;
  dispose(): Promise<void>;
}
```

- Each provider lives in `src/models/providers/<capability>/<id>.ts`. **Only these files may import a model library** (enforced by lint).
- The provider maps the global compute decision (§10) to whatever its library needs (ONNX Runtime execution provider, MediaPipe delegate, "always CPU" for Tesseract) and logs the **effective** compute target.
- Providers own their raw-score → bucket mapping (§8) and label maps (§7.2).

### 9.4 Registry (`src/models/registry.ts`)

- `getModel('face')` → lazy singleton, analogous to `get_client()`.
- `src/models/models.config.ts` lists providers per capability in preference order. Selection: the highest tier whose `requires` is satisfied by the hardware profile (§10); the user may override in settings.
- **Adding a model** = one new provider file + one line in `models.config.ts`. No consumer changes.
- **Runtime failure** (WebGPU device lost, OOM): the affected item fails closed (withheld/redacted). The registry may then switch that capability to the next lower tier for later items and logs the downgrade. An item is never passed through because its detector failed.

### 9.5 Model choices for this prototype

| Capability | Tier 1 (ships, bundled) | Tier 2 (optional, demonstrates swapping) |
|---|---|---|
| Face | **BlazeFace** short-range via MediaPipe Tasks Vision `FaceDetector` (WASM, GPU delegate = WebGL when GPU available). | **SCRFD-2.5G** ONNX via ONNX Runtime Web (WebGPU/WASM). Better on small and multiple faces. |
| OCR | **Tesseract.js v6**, `eng` language (add `hin` if time), word boxes via `recognize(img, {}, { blocks: true })` → `blocks[].paragraphs[].lines[].words[]`. CPU/WASM only; runs a small pool of pre-initialized workers. | (Future) PaddleOCR ONNX det+rec — not in scope. |
| QR | **zxing-wasm** `readBarcodes` (multiple codes, positions; restrict formats to QR + common 1D/2D). Non-ML. | — |
| NER | **gravitee-io/bert-small-pii-detection** (≈28.5M params, Apache-2.0, quantized ONNX provided, 25 PII labels). Via Transformers.js `token-classification`; if its file layout doesn't load directly, re-export to the Transformers.js layout or run with ONNX Runtime Web + the model's tokenizer — provider's choice, invisible to consumers. | **openai/privacy-filter** (Apache-2.0; Transformers.js support, q4; 50M active / 1.5B total params — large download, GPU-only tier). |

Notes to record in code and slides:

- MediaPipe's WASM loader has had problems inside module Web Workers. If that blocks, either run the MediaPipe provider on the compute host's main thread, or ship BlazeFace as an ONNX conversion on ONNX Runtime Web — a provider-internal change only.
- BlazeFace short-range is tuned for close-up faces; small faces in group photos or thumbnails may be missed. Mitigations: low detection threshold (fail-closed), and SCRFD as the tier-2 demo. Validate on the fixture set before the demo.
- The tier-1 NER model is English-focused and trained mostly on non-Indian data. **Validate on an Indian-names/addresses fixture first**; if recall is poor, pick another checkpoint — the provider contract makes this a one-file change.
- Check each model's upstream licence before any use beyond the prototype (SCRFD weights originate from InsightFace).
- Only one tier-2 provider needs to ship (face is the most visible). All others are listed as designed extension points.

### 9.6 Worker topology (compute host)

- **NER worker** ×1 (one model instance, micro-batching).
- **Vision workers** ×N, where N = `clamp(navigator.hardwareConcurrency - 2, 1, 3)`; each holds face + QR providers.
- **OCR**: Tesseract.js scheduler with K = `clamp(hardwareConcurrency / 2, 1, 2)` workers.
- Regex runs inline in the sanitization dispatcher (cheap).
- A shared bounded async queue (`src/core/pool.ts`) enforces the ceilings. No unbounded spawning; model instances are not duplicated beyond these counts (memory).
- With WebGPU, one GPU device is shared; extra vision workers mainly help pre/post-processing. Tune N from logged timings.

---

## 10. Hardware detection and compute selection

Runs once when the compute host starts, before any model loads. Browser-agnostic.

1. `navigator.gpu` present **and** `requestAdapter()` returns an adapter → `webgpu`; else `wasm`.
2. Collect a `DeviceProfile`: `{browser, gpu: {available, vendor?, architecture?}, compute, hardwareConcurrency, deviceMemoryGB?, userAgentData?.platform?}`. Fields not exposed by a browser are `undefined`, never guessed (`deviceMemory` is Chromium-only; `adapter.info` may be absent).
3. The compute decision is global; providers map it to their library (§9.3). Tesseract always reports `effective_compute: 'wasm'`.
4. The profile is logged once as the session record (§11).
5. No re-detection mid-session; device loss is a per-call failure (§9.4).

---

## 11. Logger (metrics only, never content)

### 11.1 Record schema

```ts
type OpName =
  | 'dom.phase_a' | 'dom.phase_b' | 'sanitize.regex' | 'sanitize.ner' | 'sanitize.memo_hit'
  | 'image.acquire' | 'image.face' | 'image.ocr' | 'image.qr' | 'image.redact'
  | 'image.cache_hit' | 'image.cache_miss' | 'image.revalidate'
  | 'model.load' | 'model.downgrade' | 'context.assemble' | 'backend.decide'
  | 'action.validate' | 'token.resolve' | 'action.execute' | 'agent.step';

type Outcome = 'ok' | 'fail' | 'fail_closed' | 'skipped' | 'blocked';

interface LogRecord {
  session_id: string;
  step?: number;
  op: OpName;
  t_start: number;           // performance.timeOrigin + performance.now(), ms
  t_end: number;
  duration_ms: number;
  outcome: Outcome;
  reason?: ReasonCode;       // enum, e.g. 'webgpu_device_lost' | 'cors_blocked' | 'low_confidence' | 'stale_node' | 'policy_url_token' | 'backend_rate_limited' | 'backend_invalid_response'
  ref?: string;              // opaque node_id / img_id / unit batch id only
  model_id?: string;
  tier?: 1 | 2;
  compute?: 'webgpu' | 'wasm';   // on-device execution target (not the reasoning backend)
  counts?: Partial<Record<'units' | 'spans' | 'faces' | 'words' | 'codes' | 'images' | 'bytes' | 'tokens_in' | 'tokens_out', number>>;
}

interface SessionRecord { session_id: string; started_at: number; device: DeviceProfile; models: { capability: Capability; model_id: string; tier: number; compute: string }[]; backend_id: string; backend_model?: string; }
```

### 11.2 Rules

- **No content, enforced by types.** Every field is an enum, number, boolean, or opaque ID. There is no free-text `message` field. No URLs, no page titles, no error messages from libraries (map them to a `ReasonCode`; unknown → `'unknown'`).
- One shared logger; call sites use `logger.timed(op, meta, fn)` which records start/end/outcome automatically, including on thrown errors.
- Content scripts send their records to the compute host in batches.
- Storage: in-memory ring buffer (e.g. 10,000 records), flushed to IndexedDB every few seconds. Export as JSON/CSV from the settings page. A small aggregator produces: p50/p95 latency per op, cache hit rate, fail-closed count, redaction counts per page — the numbers for the presentation.
- Logging never awaits I/O on the hot path.

---

## 12. Reasoning backend abstraction (backend-agnostic)

The extension doesn't care who does the reasoning. Its only contract with the outside world is: **send a sanitized observation, receive an action list**. The reasoning backend can be any LLM vendor (Groq, Anthropic, OpenAI, Gemini, …), a self-hosted model, or a custom agent server built later. Swapping backends never touches the pipelines, the assembler, the policy, or the executor.

Two layers:

```
Orchestrator ──▶ AgentBackend (what the extension depends on)
                   ├── LlmAgentBackend ──▶ ModelClient (Python-prototype pattern) ──▶ Groq | Anthropic | OpenAI | …
                   └── HttpAgentBackend ──▶ custom server speaking the Edward wire protocol (future)
```

- **`AgentBackend`** — observation in, `AgentResponse` out. The only interface the orchestrator knows.
- **`LlmAgentBackend`** — one generic implementation for *all* LLM vendors: owns the system prompt, converts the observation into a `ModelRequest`, calls a `ModelClient`, parses and validates the JSON reply. Vendor differences live only in `ModelClient` files (TypeScript port of the Python prototype).
- **`HttpAgentBackend`** — for a custom server that owns its own prompting/planning. POSTs the observation as versioned JSON and receives an `AgentResponse`. Specified now so the wire format is stable; built only if time permits (a stub + mock server is enough for the demo).

### 12.1 Backend contract (`src/backend/types.ts`)

```ts
interface ObservationImage { img_id: string; node_id: string; mime: 'image/jpeg' | 'image/png' | 'image/webp'; data: Uint8Array; }

interface SanitizedObservation {
  schema_version: '1';
  session_id: string;          // random per session, not linkable to the user
  step: number;
  task: string;                // the user's task, sanitized through §7 like any other text
  page: { url: string; title: string; viewport: { w: number; h: number }; scroll: { x: number; y: number } }; // sanitized
  dom: SanitizedNode[];        // §5 / §14
  images: ObservationImage[];  // already redacted and selected (§14)
  history: { step: number; thought: string; actions: Action[]; results: ActionResult[] }[]; // sanitized, no old images
}

interface BackendCapabilities { maxImagesPerRequest: number; maxImageBytes: number; maxContextTokens: number; }

interface AgentBackend {
  readonly id: string;                        // e.g. 'llm:groq', 'http:custom'
  readonly capabilities: BackendCapabilities; // used by the assembler (§14), never vendor names
  init(): Promise<void>;                      // validate config (key/endpoint present, prompt loaded)
  decide(obs: SanitizedObservation, signal?: AbortSignal): Promise<AgentResponse>; // AgentResponse: §13.1, already validated
}
```

`SanitizedObservation` is the **privacy boundary object**: it is the only thing that leaves the device, whatever the backend. The final guard (§14.5) runs on it before any backend sees it. Backends never receive the token map, raw text, raw images, or log data. A backend being self-hosted or "trusted" does not relax any redaction — the pipeline is identical for every backend.

### 12.2 `LlmAgentBackend` and the `ModelClient` layer (`src/backend/llm/`)

Follows the Python prototype's structure directly, in TypeScript:

```ts
type TextContent  = { kind: 'text'; text: string };
type ImageContent = { kind: 'image'; mime: 'image/jpeg' | 'image/png' | 'image/webp'; data: Uint8Array };
interface ModelRequest  { system: string; items: readonly (TextContent | ImageContent)[]; wantJson: boolean; }
interface ModelResponse { text: string; usage?: { inputTokens?: number; outputTokens?: number }; }

interface ClientCapabilities extends BackendCapabilities { supportsJsonMode: boolean; }

interface ModelClient {
  readonly id: string;
  readonly capabilities: ClientCapabilities;
  generate(req: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>;
}
```

`LlmAgentBackend`:

- Loads `assets/system_prompt.txt` once (§12.8).
- `decide()`: serializes the observation to one `TextContent` (compact JSON with an image index `img_id → node_id`), then one `ImageContent` per image in the same order → `ModelRequest` → `client.generate()` → extract the first JSON object → validate against §13.1. Invalid → one retry with a short error note; second failure → throws `backend_invalid_response`.
- Exposes the client's capabilities as its own.
- Contains no vendor-specific code.

Registry: `getClient()` → lazy singleton (mirrors the Python prototype's `config.get_client()`), reading `src/backend/llm/clients.config.ts`.

### 12.3 `HttpAgentBackend` and the wire protocol (`src/backend/http/`)

- `POST {endpoint}/v1/decide`, `Content-Type: application/json`, body = `SanitizedObservation` with image `data` as base64. Optional `Authorization: Bearer <token>` from settings.
- Response `200` = `AgentResponse` JSON (§13.1), validated by the same type guard as the LLM path.
- `GET {endpoint}/v1/capabilities` → `BackendCapabilities`, fetched in `init()`.
- Versioned by `schema_version`; a server that doesn't support the version returns `426` → backend refuses to start.
- Publish this as `docs/WIRE_PROTOCOL.md` with JSON Schema files generated from the TypeScript types, so a future server (in any language) can be built against it.
- Demo scope: stub implementation + a tiny mock server used only in tests.

### 12.4 Registry and settings (`src/backend/registry.ts`)

- `getBackend()` → lazy singleton. `src/backend/backends.config.ts` maps backend kinds (`llm`, `http`) to factories.
- Settings page: backend kind; for `llm` → provider, model ID, API key (plus base URL for `openai-compatible`); for `http` → endpoint URL, optional token.
- **Custom endpoints need host permission at runtime.** The manifest declares the known vendor hosts in `host_permissions` and `https://*/*` in `optional_host_permissions`; saving a custom endpoint calls `platform.requestHostPermission(origin)` (added to the `Platform` interface, §4.2). Only HTTPS endpoints are accepted (plus `http://localhost` for development).
- Startup validation (like the Python prototype): the agent refuses to start with a clear UI message if `init()` fails.

### 12.5 Extension rules — what adding a backend requires

| Adding… | Requires only |
|---|---|
| A new LLM vendor | `src/backend/llm/clients/<vendor>.ts` implementing `ModelClient` + one line in `clients.config.ts` |
| A self-hosted OpenAI-compatible model server (vLLM, Ollama, LM Studio…) | Nothing new — use the `openai-compatible` client with a custom base URL from settings |
| A custom agent server | Implement the wire protocol server-side; select `http` in settings |
| A new backend *kind* | `src/backend/<kind>/` implementing `AgentBackend` + one line in `backends.config.ts` |

Never requires changes to: `AgentBackend`, `SanitizedObservation`, `AgentResponse`, `ModelClient` shapes, existing clients/backends, the assembler, the orchestrator, or the executor. `openaiCompatible.ts` is both a usable client (provider `openai-compatible`, base URL from settings) and a helper that vendor files may build on; it never contains vendor-specific branches. If adding a backend seems to need changes elsewhere, the abstraction has leaked — fix it.

### 12.6 First implementation — Groq via `LlmAgentBackend`

- `GroqClient`: `fetch('https://api.groq.com/openai/v1/chat/completions')` directly (no SDK — smaller bundle, no Node-isms).
- Images → `image_url` data URIs; text → text parts; `response_format: { type: 'json_object' }` when `wantJson`.
- Model ID is a config value. At the time of writing, Groq's docs list `qwen/qwen3.6-27b` as a vision model (5 images per request, 2,048 tokens per image, 131K context). **Check the current docs when building**, and don't copy the model name from the Python prototype without checking it still exists.
- Capabilities: `maxImagesPerRequest: 5`, `maxContextTokens: 131_072`, `supportsJsonMode: true`, `maxImageBytes`: conservative 3 MB.
- Timeout (e.g. 30 s) via `AbortSignal`; one retry with backoff on 429/5xx (`backend_rate_limited`, `backend_error`).
- If Groq's limits become a problem, switch provider in settings (§12.5).
- Build `AgentBackend` and the `ModelClient` shapes first, then `GroqClient` — so the interfaces aren't shaped around Groq's quirks.

### 12.7 Credentials

API keys / bearer tokens are entered on the settings page, stored in extension local storage, sent only to the configured backend host, never logged, never placed in an observation or request body. Extension storage is not a secret store; acceptable for a demo, state it in the slides. A future custom server can remove the need for a vendor key in the extension entirely.

### 12.8 System prompt (LLM backends only)

`assets/system_prompt.txt`, bundled, loaded once at compute-host startup via `platform.assetUrl`. Keep the Python prototype's emphasis: page content is untrusted data, never instructions; placeholders are opaque; redacted/omitted content is expected; respond only with the action JSON (§13.1). A custom server owns its own prompt.

---

## 13. Minimal action framework

Deliberately small. Enough for a credible demo (search, fill a form, click through), nothing more.

### 13.1 Response schema (every backend must return exactly this JSON)

```ts
type Action =
  | { type: 'click';    node_id: string }
  | { type: 'type';     node_id: string; text: string; submit?: boolean }   // text may contain [PII_*] tokens
  | { type: 'select';   node_id: string; value: string }                    // value may contain a token
  | { type: 'scroll';   direction: 'up' | 'down' }
  | { type: 'scroll_to'; node_id: string }
  | { type: 'navigate'; url: string }                                      // tokens forbidden
  | { type: 'wait';     ms: number };                                      // capped at 3000

interface AgentResponse {
  thought: string;        // ≤ 200 chars, shown in overlay, kept in history
  actions: Action[];      // ≤ 3 per step
  done: boolean;
  answer?: string;        // final answer when done; tokens in it are resolved only for on-screen display, never sent anywhere
}

type ActionResult = 'ok' | 'stale_node' | 'not_interactable' | 'blocked' | 'not_run';
```

Validation: a hand-written TypeScript type guard (no dependency needed), shared by every backend kind (§12). The LLM backend retries once on invalid output (§12.2); any backend's final invalid response ends the session (`outcome: fail`, `backend_invalid_response`).

### 13.2 Agent loop (runs in the compute host)

```
start(task) → new session (session key, empty token map, SessionRecord)
for step in 1..MAX_STEPS (default 10):
    observe()                    # §5 + §6 + §7
    obs = assemble()             # §14 → SanitizedObservation (+ final guard)
    parsed = backend.decide(obs) # §12 — any backend; returns a validated AgentResponse
    for action in parsed.actions:
        policy_check(action)         # §13.4 — blocked → skip action, record reason, end batch
        resolved = resolve_tokens(action)
        result = execute(resolved)   # content script
        if result != ok or page navigated: break
    wait_for_settle()  # DOM quiet for 300 ms (MutationObserver) or 3 s cap
    if parsed.done: break
end → clear token map, memo, session key
```

History sent to the backend: previous steps' `thought` + actions + execution results only (all sanitized). Earlier observations and images are **not** resent (latency, image limits).

The user can stop at any time from the overlay or popup. Stopping aborts the in-flight request (`AbortSignal`).

### 13.3 Executor (content script)

- Resolve `node_id` via the Element Registry; missing → `stale_node`.
- `click`: `scrollIntoView({block: 'center'})`, focus, dispatch `pointerdown/mousedown/pointerup/mouseup/click`.
- `type`: focus; set the value through the native `HTMLInputElement`/`HTMLTextAreaElement` value setter (so React/Vue-controlled inputs update); dispatch `input` and `change`; if `submit`, `requestSubmit()` on the form or dispatch Enter. `contenteditable` → `insertText` via `beforeinput`/`input`.
- `select`: set `value`, dispatch `change`.
- `navigate`: `location.assign(url)` (http/https only).
- Returns `{ok | stale_node | not_interactable | blocked}`. Only these `ActionResult` codes are reported back to the backend.

### 13.4 Token egress policy (checked before resolution)

1. Tokens may be resolved **only** in `type.text` and `select.value`.
2. Any token in `navigate.url` → action blocked (`policy_url_token`). `navigate.url` must be http/https.
3. A token resolves only if its `origin` equals the current page's origin (`policy_cross_origin`).
4. `type`/`select` into an element whose form `action` points to a different origin → blocked (`policy_form_origin`).
5. The target of `type` must be an editable, non-secret field (`policy_target`).
6. An unknown token (not in the map) → blocked (`policy_unknown_token`); never typed literally.
7. Every resolution and every block is logged (counts and reason codes only).

Blocked actions end the current batch and are reported to the backend as `blocked`, so it can re-plan.

### 13.5 Out of scope for actions

Multiple tabs, downloads, file upload, drag and drop, hover menus, keyboard shortcuts, iframe content, CAPTCHAs.

---

## 14. Sanitized observation assembly

1. Wait for: Phase A, all Phase B results, and processing of the images selected in step 3.
2. Serialize the DOM tree as compact JSON: omit default/empty fields, short enums, integer boxes. Drop `visible: false` subtrees' text beyond a short cap. Target a token budget (e.g. ≤ 40% of `maxContextTokens`, and much less in practice for latency); if exceeded, trim non-interactive text from off-viewport regions first and mark `truncated: true`.
3. **Image selection** uses `backend.capabilities`, never backend names: in-viewport first, then larger area; keep up to `maxImagesPerRequest`. Others get `image_omitted: "request_limit"` on their node. Re-encode to fit `maxImageBytes`.
4. Build one `SanitizedObservation` (§12.1): task, step, page metadata, DOM, selected images, history. How it is turned into a vendor request is the backend's job (§12.2), not the assembler's.
5. Final guard (defence in depth): before handing the observation to any backend, scan all its string fields with the Tier-1 regex set once more; any hit that is not on this step's allowlist of values the heuristic marked public (§7.5) → abort the step with `fail_closed` (indicates a pipeline bug). This is a check, not a sanitizer.
6. The token map is never touched by the assembler.

---

## 15. Latency plan (scored criterion)

- **Warm start:** hardware detection, model loads, Tesseract worker init and one warm-up inference per model happen when the compute host starts, not on the first task. Log `model.load` times.
- **Parallel observation:** Phase B text and image processing run concurrently; the assembler only waits for images it will send.
- **Skip work:** size floor (§6.1), hidden containers (§6.7), header/footer trimming (§5.4), memo (§7.7), image cache (§6.6).
- **Batching:** NER micro-batching (§7.2); chunked messaging (§5.2).
- **Small payloads:** compact JSON, downscaled images, no history images (§13.2).
- **Measure, then tune:** a benchmark script replays the fixture pages and prints p50/p95 per op from the logger. Record baseline numbers on day 1 of the vertical slice and set targets from them; report WebGPU vs WASM numbers side by side in the presentation.

---

## 16. Explicit out-of-scope / boundary decisions

State these in code comments and in the presentation:

- Iframes (same- and cross-origin) — not traversed; marked. A privacy stance: payment widgets, auth and embedded chat are the riskiest content.
- Closed shadow roots — unreachable; marked.
- `<canvas>`, inline `<svg>`, `<video>` — not processed; marked.
- QR/barcode content classification — all codes redacted.
- Tier 3 LLM disambiguation — cut; ambiguous spans redacted.
- Multi-tier models — built as an interface; tier 2 demonstrated for face only.
- Custom reasoning server — the wire protocol is specified and a stub client exists; no server is built. The demo uses Groq through the generic LLM backend.
- Secret fields — never read, never typed by the agent.
- Safari — builds from the same code; not part of the demo.
- API key in extension storage — acceptable for a prototype, not production.

---

## 17. Repository layout and tooling

- **Build tool:** WXT (TypeScript, Vite-based; builds Chrome/Edge/Firefox/Safari from one codebase; MV3 manifests generated per target).
- **Language:** TypeScript `strict`, `noUncheckedIndexedAccess`. Workers are TypeScript modules bundled by Vite.
- **Tests:** Vitest (unit), Playwright with Chromium (extension end-to-end), `web-ext run` for Firefox smoke tests.
- **Lint:** ESLint with import-boundary rules (§4.2, §9.3).

```
edward/
  docs/SPEC.md                      # this document
  docs/WIRE_PROTOCOL.md             # custom-server contract + generated JSON Schemas (§12.3)
  reference/python-prototype/       # Python pattern reference (not built)
  src/
    entrypoints/                    # WXT entrypoints: background, content, offscreen (chromium only), popup, settings
    platform/                       # ONLY browser-dependent code (§4)
      index.ts  chromium.ts  gecko.ts  webkit.ts  messages.ts
    core/                           # pool, ids, hashing, time, types shared everywhere
    dom/                            # phase A/B, visibility, registry, executor, overlay
    sanitize/                       # regex (+verhoeff, luhn), ner dispatcher, heuristic, tokens, memo, url
    image/                          # acquire, pipeline, redact, cache, priority
    models/                         # capabilities, provider, registry, models.config
      providers/face/  providers/ocr/  providers/qr/  providers/ner/
    backend/                        # types (AgentBackend, SanitizedObservation), registry, backends.config
      llm/                          # LlmAgentBackend, ModelClient types, clients.config
        clients/                    # groq.ts, openaiCompatible.ts (+ future vendors)
      http/                         # HttpAgentBackend (wire protocol client; stub for demo)
    agent/                          # schema, validate, policy, resolver, loop, assemble
    logging/                        # logger, schema, sink (idb), aggregate, export
    hw/                             # detect.ts
  assets/system_prompt.txt
  public/                           # bundled wasm, worker glue, model weights (tier 1)
  tests/
    fixtures/                       # local HTML pages with synthetic PII
    unit/  e2e/  bench/
  CLAUDE.md
```

---

## 18. Testing

1. **Canary leak test (most important).** Fixture pages contain synthetic PII values ("canaries") in text, attributes, URLs, and images (rendered text, faces from a synthetic-face set, QR codes). The e2e test loads the extension, runs one observation, captures the outgoing `SanitizedObservation` with a mock backend registered via `getBackend()` (and, separately, the serialized Groq request body), and asserts that **no canary appears** in either, or in exported logs. Also OCR the outgoing images and check for canaries.
2. **Regex unit tests:** valid/invalid Aadhaar (Verhoeff), cards (Luhn), PAN, IFSC, UPI vs email, Indian phone formats, masked Aadhaar.
3. **Policy tests:** every §13.4 rule has a failing and a passing case.
4. **Model fixture sets:** Indian names/addresses for NER recall; small-face and group photos for face recall. Record recall per provider — slide material.
5. **Cross-browser smoke:** Chrome (e2e), Edge and Firefox (manual checklist: load, observe, one action).
6. **Benchmark:** §15.

All fixture PII is synthetic. Never use real people's data.

---

## 19. Build order (≈9 build days after the JS/TS ramp-up)

Vertical slice first, then depth.

| Day | Goal |
|---|---|
| 1 | Repo + WXT scaffold for Chrome and Firefox; platform layer skeleton + messaging; shared types (`capabilities.ts`, `backend/types.ts`, agent schema, log schema); logger; hardware detection; fixture pages; canary test harness (failing). |
| 2–3 | **Vertical slice:** Phase A + Phase B with regex-only sanitization + token map; `AgentBackend` + `LlmAgentBackend` + `GroqClient` + registries + settings page; minimal loop with `click`/`type` + policy + resolver; overlay. Canary test passes for text. Baseline latency numbers. |
| 4–5 | NER provider + micro-batching + memo; public-email heuristic; URL sanitization; header/footer and visibility rules; secret fields. |
| 6–7 | Image pipeline: acquisition, BlazeFace, Tesseract, zxing, redaction, cache, prioritization, image selection; canary test for images. |
| 8 | Tier-2 face (SCRFD); Firefox pass; latency tuning from logs; benchmark script; `HttpAgentBackend` stub + mock server test + `WIRE_PROTOCOL.md` (if time). |
| 9 | Integration across real sites; bug fixing; cut per §16; export numbers for slides. |

Cut order under time pressure: tier-2 face → cache revalidation (keep TTL only) → background-image support → public-email heuristic (treat all emails as private) → Firefox polish.

---

## 20. Instructions for the implementer (e.g. Claude Code)

- §2 is binding. When unspecified, choose the more fail-closed, more explainable, more local option — then the faster one.
- Write interfaces before implementations: capability interfaces (§9) before any provider; `AgentBackend`/`SanitizedObservation` and `ModelClient` shapes (§12) before `GroqClient`; the platform interface (§4) before any browser implementation.
- Never import a model library outside `src/models/providers/`, never touch extension APIs outside `src/platform/`, never reference a specific vendor outside `src/backend/llm/clients/`.
- The orchestrator and assembler depend only on `AgentBackend` and `SanitizedObservation`. Everything the extension sends, to any backend, is a `SanitizedObservation`.
- Never build a whole-page or multi-node concatenated model input.
- Every exclusion leaves a marker in the output.
- The logger never receives content. If you need a new failure reason, add a `ReasonCode`.
- Wire the logger into each subsystem as it is built.
- If a browser API limitation conflicts with a privacy guarantee (CORS, CSP, missing API in one browser), stop, describe it, and propose a fail-closed workaround. Do not relax a guarantee to make something work.
- Keep browser-specific workarounds inside `src/platform/` and add each one to §4.3.
