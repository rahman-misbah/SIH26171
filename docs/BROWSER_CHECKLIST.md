# Edward — Manual browser checklist (SPEC §4.4, §18.5)

Chrome is covered by `npm run test:e2e`. Firefox (full pass) and Edge (smoke test) are checked
by hand with this list. Every step says what to look for; record pass/fail and anything odd in
the milestone Log.

The checks use the **e2e build flavour** (`EDWARD_E2E=1`). It is the same extension, plus a
test-only hook: on every page load the content script runs one observation with the mock
backend and writes the outgoing `SanitizedObservation` to `<html data-edward-observation>`, so
you can inspect exactly what would leave the device. Release builds don't contain this hook.

## 0. Setup (once per session)

```sh
npm run serve-fixtures            # terminal 1: fixture pages on http://127.0.0.1:8123 (+ :8124)
```

Snippets used below (paste into the **page's** devtools console):

**S1: leak check + outgoing images.** Lists any canary found in the outgoing observation and
appends each outgoing (redacted) image to the bottom of the page with a red border.

```js
(async () => {
  const raw = document.documentElement.dataset.edwardObservation;
  if (!raw) return console.warn('no observation yet: wait a few seconds and rerun');
  const result = JSON.parse(raw);
  const canaries = await (await fetch('/canaries.json')).json();
  const leaks = canaries.filter((c) => raw.includes(c.value)).map((c) => c.id);
  console.log('status:', result.status, '| canaries found in outgoing observation:', leaks);
  const obs = result.observation ?? {};
  console.log('omitted images:', (obs.dom ?? []).filter((n) => n.image_omitted).map((n) => [n.content.accessible_name, n.image_omitted]));
  console.log('markers:', (obs.dom ?? []).filter((n) => n.marker).map((n) => n.marker));
  for (const img of obs.images ?? []) {
    const el = document.createElement('img');
    el.src = `data:${img.mime};base64,${img.data.base64}`;
    el.style.cssText = 'border:3px solid red;margin:4px;max-width:320px';
    document.body.append(el);
  }
  console.log('outgoing images appended:', (obs.images ?? []).length);
})();
```

**S2: metrics summary.** Paste into the **compute host's** console (Firefox: the background
page; Chromium: the offscreen document; see each browser's section for how to open it).

```js
(async () => {
  const db = await new Promise((ok, err) => { const r = indexedDB.open('edward-logs', 1); r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); });
  const all = (s) => new Promise((ok) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => ok(q.result); });
  const [records, sessions] = [await all('records'), await all('sessions')];
  const by = {};
  for (const r of records) (by[r.op] ??= []).push(r.duration_ms);
  const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };
  console.table(Object.fromEntries(Object.entries(by).map(([op, d]) => [op, { n: d.length, p50: pct(d, 0.5), p95: pct(d, 0.95) }])));
  console.log('device:', sessions.at(-1)?.device);
  console.log('model loads:', records.filter((r) => r.op === 'model.load').map((r) => [r.model_id, Math.round(r.duration_ms), r.compute, r.outcome]));
  console.log('failures:', records.filter((r) => r.outcome !== 'ok').map((r) => [r.op, r.outcome, r.reason]));
})();
```

Logs are flushed every 5 s, so wait a few seconds after the last page load before running S2.

## 1. Firefox (full pass)

```sh
EDWARD_E2E=1 npm run build:firefox
npx web-ext run -s .output/firefox-mv3 \
  --pref network.dns.localDomains=xo.edward.test \
  --url http://127.0.0.1:8123/pages/profile.html
```

`network.dns.localDomains` makes Firefox resolve `xo.edward.test` to 127.0.0.1. It stands in
for Chromium's `--host-resolver-rules` in the e2e suite (the §6.2.2 fetch fallback refuses
127.0.0.1 itself).

To open the compute host console: go to `about:debugging#/runtime/this-firefox`, find **edward**
and click **Inspect**. That is the background event page, which is the compute host on Firefox
(§4.1).

| # | Step | Look for |
|---|---|---|
| F1 | `about:debugging` → edward | Loads with no errors. Manifest: background is `scripts` (event page), no `offscreen` permission. |
| F2 | Site access: click the Edward toolbar button, type any task, press **Start** | No permission prompt: Firefox (156, M10) grants `<all_urls>` at install. If a prompt for "Access your data for all websites" does appear, allow it and note the Firefox version. The popup then shows either "Started" or "Reload the page and press Start again". Note which one. Pressing Start again after allowing should not prompt a second time. |
| F3 | Deny path: `about:addons` → edward → Permissions → turn site access off, then press Start and click **Don't allow** if prompted | Firefox 156 (M10): no prompt. Opening Edward's popup grants access to the current tab (likely `activeTab`; Firefox shows "run for this site only" greyed out) and the task runs there. If a prompt does appear, **Don't allow** must make the popup say Edward needs access to websites and nothing runs. Turn access back on afterwards. |
| F4 | Warm start: in the compute host console, wait ~30 s after launch, run **S2** | 4 `model.warmup` rows; `model.load` for face, OCR, QR and NER, all `ok`, compute `wasm` (Firefox on Linux has no WebGPU). Note the load times. |
| F5 | Text pages: open `profile`, `form`, `comments`, `contact`, `query-links`, `secret-form`, `iframe` (URLs printed by `serve-fixtures`); on each, run **S1** | `status: ok`. Canaries found: `[]` everywhere, **except** `email-public-support` on `contact.html`, which stays visible by design (§7.5 public-email heuristic). `iframe`: an `iframe_skipped` marker. |
| F6 | `canvas.html` → **S1** | A `canvas_skipped` marker; no canaries. |
| F7 | Images: open `faces.html`, `images-text.html`, `images.html` → **S1** on each | No canaries. Appended images: every face covered by a black box; on the text images PII (email, phone, PAN…) boxed but ordinary words ("Order summary", "shipped", "front desk") still readable; the QR code blacked out. `images.html`: 4 images sent, the rest `request_limit`. This exercises Tesseract's classic worker, the zxing and MediaPipe module workers, and the `Uint8Array` payload over Firefox's structured-clone messaging. |
| F8 | Reload `images.html` → S1 | Same result. S2 in the compute host shows `image.cache_hit` rows (second observation answered from the cache). |
| F9 | Fetch fallback: open the `images-unreadable.html?xo=…&xp=…` URL → S1 | Omitted images: `missing image`, `not an image`, `private-host image`, `no source` → `unreadable`; `tiny image` → `too_small`; **`cross-origin image` is not in the list** (fetched by the compute host and sent). If it shows `unreadable` instead, Firefox didn't give the background page cross-origin fetch access; note it (§4.3 item 16 is unverified on Firefox). S2 failures should include `image.acquire … private_host`. |
| F10 | Egress guard: compute host → **Network** tab, reload `faces.html`, then keep the event page busy for 70 s (reload a fixture page every ~10 s; Firefox stops an idle event page after ~30 s, before MediaPipe's 60 s upload timer fires) | No request to `odml.pa.googleapis.com` or any host other than the extension itself and 127.0.0.1/xo.edward.test. S2 failures include `egress_blocked` rows (MediaPipe's metrics upload, refused). |
| F11 | **One action**: open `agent-form.html`, wait 2 s, then paste the seed snippet below into the page console, then in the popup enter `Fill in the email field with alice.agent.canary@example.com` and press **Start** | The overlay shows progress; the email field fills with `alice.agent.canary@example.com`. The backend (mock) only ever saw a token, never the address. |
| F12 | Event page unload: leave Firefox idle ~1 min, then check `about:debugging` (background shows *Stopped*?), then open `faces.html` and run S1 | Still works (compute host restarts on the next message). S2 shows a second session and a second set of `model.load`/`model.warmup` rows, since warm start reruns on wake. Note the first-observation delay. |

Seed snippet for F11 (makes the mock backend return one `type` action into the email field;
e2e builds only):

```js
(() => {
  const obs = JSON.parse(document.documentElement.dataset.edwardObservation).observation;
  const email = obs.dom.find((n) => n.attrs?.name === 'email');
  document.documentElement.dataset.edwardE2eSeedScript = JSON.stringify([
    { thought: 'typing the email from the task', done: false, actions: [{ type: 'type', node_id: email.node_id, text: '[PII_EMAIL_1]', submit: false }] },
  ]);
  console.log('seeded for node', email.node_id);
})();
```

## 2. Edge (smoke test)

**Cut in M10 (2026-09-25, SPEC §16): not run.** Kept here in case it's picked up again.

Install (Fedora, needs sudo):

```sh
sudo dnf config-manager addrepo --from-repofile=https://packages.microsoft.com/yumrepos/edge/config.repo
sudo dnf install -y microsoft-edge-stable
```

```sh
EDWARD_E2E=1 npm run build
```

Open `edge://extensions`, turn on **Developer mode**, **Load unpacked** → `.output/chrome-mv3`.
For the compute host console: `edge://extensions` → edward → *Inspect views: offscreen.html*
(appears once the service worker has created it at startup).

| # | Step | Look for |
|---|---|---|
| E1 | Load | No errors on the extension card; service worker active. |
| E2 | Warm start: inspect `offscreen.html` ~30 s after loading → **S2** | 4 `model.warmup` rows, all loads `ok`. |
| E3 | `profile.html` and `faces.html` → **S1** | No canaries; faces boxed. |
| E4 | **One action**: F11 on `agent-form.html` (seed snippet, then popup Start) | Email field fills. Popup Start does **not** show a site-access message (Chromium grants it at install). |

## Results

Record results in the milestone Log (`docs/MILESTONES.md`), including any step that behaved
differently from "Look for".
