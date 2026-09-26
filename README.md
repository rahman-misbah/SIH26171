# Edward

A browser extension that acts as a privacy firewall for browser agents. It reads the page on your
device, replaces PII with tokens like `[PII_NAME_1]`, redacts faces, QR codes and PII in images,
and sends only that sanitized view to the reasoning backend (Groq by default). The actions that
come back run locally, where tokens are swapped back to the real values.

The design is in [`docs/SPEC.md`](docs/SPEC.md); progress is in [`docs/MILESTONES.md`](docs/MILESTONES.md).

## Setup

Needs **Node 24** (the scripts run TypeScript directly).

```sh
npm ci
npm run fetch-models   # model weights (~180 MB) into public/models/, not committed
npm run build          # Chrome/Edge  -> .output/chrome-mv3
npm run build:firefox  # Firefox      -> .output/firefox-mv3
```

`npm run test:e2e` overwrites `.output/chrome-mv3` with a **test build** that writes each
observation into the page. Run `npm run build` again before using Edward on real sites.

## Running it

**Chrome / Edge:** `chrome://extensions` (Edge: `edge://extensions`) → Developer mode →
*Load unpacked* → `.output/chrome-mv3`.

**Firefox:** `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* →
`.output/firefox-mv3/manifest.json`. It's removed when Firefox closes, and settings don't
survive re-adding it (*Reload* keeps them). Check `about:addons` → Edward → *Permissions*:
site access and `api.groq.com` must be on.

**Settings** (Chrome: Edward → *Details* → *Extension options*; Firefox: `about:addons` → Edward
→ *Preferences*):
- **Reasoning backend:** Groq (paste an API key; model optional), any OpenAI-compatible server, or
  a custom agent server ([`docs/WIRE_PROTOCOL.md`](docs/WIRE_PROTOCOL.md)).
- **On-device models:** one choice per capability. Without a working GPU, set face detection to
  SCRFD; *Automatic* then uses BlazeFace, which misses faces in group photos.
- Changes apply only after Edward restarts: toggle it off/on (Chrome) or *Reload* (Firefox), then
  wait ~30 s for the models to warm up.

**Use:** open a page, click the Edward icon, type a task, press **Start**. The overlay shows each
step; **Stop** ends it. Each step is one backend request with at most 3 actions.

**Test pages:** `npm run serve-fixtures` serves pages with **synthetic** PII at
`http://127.0.0.1:8123/pages/` (e.g. `agent-form.html`, `secret-form.html`, `faces.html`). On real
sites use made-up PII; <https://httpbin.org/forms/post> is a simple form. Pages inside iframes
(CodePen, W3Schools "Try it") are skipped by design.

## Seeing what leaves the device

Everything runs in the **compute host**; open its DevTools:
- Chrome/Edge: extensions page → Edward → *Inspect views: offscreen.html*
- Firefox: `about:debugging` → Edward → *Inspect* (the background page)

**Network tab** (turn on *Preserve log* / *Persist Logs*, filter by `groq`): each
`chat/completions` request body is exactly what the backend received (the task and page with
tokens, `[SECRET]` fields, exclusion markers like `iframe_skipped`, `truncated`/`trimmed` where
the page-text budget cut content). Images are `data:image/jpeg;base64,…` URLs: paste one into a
tab to see the redacted image. *Response* holds the actions that came back. Nothing else should
leave; model workers can only reach the extension itself (refused attempts are logged as
`egress_blocked`). Right-click → *Save All As HAR* to keep a copy.

**Test build only** (`EDWARD_E2E=1 npm run build`): the observation is also written to
`<html data-edward-observation>` on every page load; snippet **S1** in
[`docs/BROWSER_CHECKLIST.md`](docs/BROWSER_CHECKLIST.md) checks it for leaks and shows the outgoing
images. Never browse logged-in sites with this build: the page can read that attribute.

## Logs

Metrics only: op names, timings, device, outcomes, reason codes. No page text, URLs or error
messages. Stored in IndexedDB `edward-logs` (stores `records` and `sessions`) in the compute host,
written every 5 s, kept until the extension is removed.
- View: compute host DevTools → *Application* (Chrome) / *Storage* (Firefox) → IndexedDB.
- Summary: paste snippet **S2** from [`docs/BROWSER_CHECKLIST.md`](docs/BROWSER_CHECKLIST.md) into
  the compute host console for p50/p95 per op, device, model loads and failures.
- There is no export button; copy the S2 output.

## Benchmarking

All three use the mock backend (no API key, no reasoning backend), drive **Chromium** through
Playwright in a visible window, and add a section named by `--label` to a file under `docs/`, so
every PC gets its own table. Put the CPU/GPU in the label; the browser only reports cores, memory
(capped at 8 GB) and the GPU vendor/architecture.

| Command | Measures | Saved to |
|---|---|---|
| `npm run bench -- --label "i5-10210U, Fedora"` | p50/p95 per op over the fixture pages, WASM vs WebGPU; model load/warm-up | `docs/BENCHMARKS.md` |
| `npm run bench:faces -- --label "…" [--compute wasm\|webgpu]` | face recall and speed, BlazeFace vs SCRFD | `docs/BENCHMARKS.md` |
| `npm run realsites -- --label "…" [--no-build]` | one observation on 11 real sites: time, counts, leak candidates (needs internet) | `docs/REAL_SITES.md` |

- `npx playwright install chromium` once per PC. Linux without a display: `xvfb-run npm run bench …`.
- No usable GPU: `npm run bench -- --label "…" --only wasm`. The WebGPU flags are tuned for Linux;
  elsewhere check the WebGPU column isn't "unavailable".
- `EDWARD_REALSITES_ONLY=wikipedia,flipkart` narrows the real-site run.
- Plug in and close other apps (especially Firefox running Edward). Results vary run to run, so run
  twice and keep the steadier one; compare numbers within one table only.
- Send back or commit the changed `docs/*.md` files.
- Firefox isn't automated: load Edward, open the fixture pages, run S2 in the background page's
  console and record its table.
- Not measured: CPU %, RAM use, power.

How to read the tables: the headers of [`docs/BENCHMARKS.md`](docs/BENCHMARKS.md) and
[`docs/REAL_SITES.md`](docs/REAL_SITES.md). Slide-ready numbers: [`docs/SLIDE_NUMBERS.md`](docs/SLIDE_NUMBERS.md).

## Development

```sh
npm run dev            # Chrome with reload (npm run dev:firefox for Firefox)
npm run check          # tsc + ESLint (boundary rules)
npm test               # unit tests
npm run test:e2e       # Playwright, Chromium (then npm run build again)
```

Manual browser pass: [`docs/BROWSER_CHECKLIST.md`](docs/BROWSER_CHECKLIST.md). Demo script:
[`docs/DEMO.md`](docs/DEMO.md). Never commit API keys; fixtures use synthetic PII only.

## Known behaviour

- Firefox stops Edward's background page after ~30 s idle; the next step reloads the models and
  is slow. Keeping its *Inspect* window open keeps it alive.
- Only page text near the viewport is processed (budget); the agent scrolls for the rest.
- Some words are over-redacted as names (e.g. "Bacon"); this fails safe.
- `backend_rate_limited` in the overlay: the backend's rate limit; wait and press Start again.
