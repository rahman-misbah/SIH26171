# Edward — Numbers for the slides

Collected at the M12 freeze (2026-09-25/26) from the files named in each section. Everything was
measured on the dev laptop: i5-10210U (4 cores / 8 threads), UHD 620 + MX230, Fedora, Chrome.

**Read this first.** On 2026-09-24 and 2026-09-25 the same laptop ran the same unchanged code
(OCR, QR) 3–4× apart, and Chrome picked a different GPU adapter (Intel on the 24th, NVIDIA on the
25th). Power or GPU state varies, so compare numbers **within one table only**. Before/after claims
below rest on unit counts, which don't depend on the machine, as well as on timings.

---

## 1. Privacy

| Claim | Evidence |
|---|---|
| No synthetic canary leaks, in text or in images | 21 canaries across 15 fixture pages (`tests/fixtures/canaries.json`). The e2e canary test checks the outgoing observation and re-OCRs every outgoing image. The only survivor is by design: a public support email (§7.5). |
| No PII left in outgoing text on real sites | 11 real sites, 0 leak candidates: regex re-scan of everything sent (`docs/REAL_SITES.md`). |
| Secret fields never read | Password, OTP and CVV values never appear. The field carries `[SECRET]`. |
| Only the sanitized observation leaves the device | Model workers' network access is limited to the extension's own origin. MediaPipe's metrics upload is refused and logged (`egress_blocked`) on Chrome and Firefox. |
| Logs hold no content | `LogRecord` has no free-text field (§11). Reason codes only. |

## 2. Latency: fixture pages (`docs/BENCHMARKS.md`, WASM, warm, ms)

| Op | p50 | p95 |
|---|---:|---:|
| DOM Phase A (structure) | 1 | 24 |
| Text sanitization per 200-unit chunk (regex + NER) | 159 | 248 |
| NER, one micro-batch | 57 | 166 |
| Face detection (BlazeFace) | 23 | 39 |
| OCR (Tesseract) | 230 | 329 |
| QR (zxing) | 39 | 51 |
| Redaction + encode | 5 | 13 |
| Image cache hit | 0 | 0 |
| Assembly | 1 | 2 |
| Model load at startup (paid once, before the first task) | 1079 | 1088 |

WebGPU (NVIDIA MX230) was **slower** than WASM on this laptop for NER (218 vs 57 ms) and face
detection. The one clear GPU win is SCRFD face detection: 132 ms on WebGPU vs 772 ms on WASM
(face-recall run). Don't claim a general GPU speed-up.

## 3. Latency: real sites (`docs/REAL_SITES.md`)

| Site | Observation (s) | Nodes sent | Text KB |
|---|---:|---:|---:|
| GitHub login | 1.2 | 93 | 22 |
| GitHub profile | 2.8 | 512 | 120 |
| YouTube API docs | 3.5 | 581 | 131 |
| isro.gov.in | 3.8 | 607 | 154 |
| india.gov.in | 4.4 | 650 | 149 |
| Wikipedia (ISRO article) | 4.7 | 491 | 124 |
| DuckDuckGo results | 5.0 | 230 | 62 |
| Flipkart listing | 5.0 | 1081 | 222 |
| The Hindu | 8.8 | 303 | 83 |

**Before M12** the same pages took 28–95 s or timed out: NER ran on every text unit (385 NER batches of up to 16
texts each on the Wikipedia page). **After:** a text budget (on-screen and clickable content first,
then nearest; at most 300 units and 12,000 characters) and length-grouped NER batches. The rest of
the page is never processed. The observation says so, and the agent scrolls to reach it.

## 4. Face detection: tier 1 vs tier 2 (`docs/BENCHMARKS.md`)

18 synthetic faces from 160 px down to 20 px.

| Provider | Recall | Smallest face found | Detect ms (WASM / WebGPU) |
|---|---|---|---:|
| BlazeFace (tier 1, 230 KB) | 3/18 (4/18 on GPU) | 128 px | 32 / 21 |
| SCRFD-2.5G (tier 2, 3.3 MB) | 18/18, 0 false positives | 20 px | 772 / 132 |

Switching is one setting. No code changes.

## 5. Size

| Part | Size |
|---|---:|
| NER model (BERT-small, int8) | 29 MB |
| OCR language data (English) | 11 MB |
| SCRFD-2.5G | 3.3 MB |
| BlazeFace | 230 KB |
| ONNX Runtime Web (4 wasm builds) | 83 MB |
| MediaPipe runtime | 12 MB |
| Tesseract core | 6.7 MB |
| zxing | 0.9 MB |
| **Unpacked extension** | **171 MB** |

Every on-device model runs offline after install, with no first-run download and no CDN. Only the reasoning backend needs the network.

## 6. Engineering

- 609 unit tests (76 files), 17 end-to-end tests (Chromium with the real extension), plus the
  benchmark, face-recall and real-site harnesses.
- Chrome (primary, automated) and Firefox 156 (full manual pass, M10). Edge smoke test cut.
- Backends: Groq, any OpenAI-compatible server, or a custom agent server over a versioned wire
  protocol (`docs/WIRE_PROTOCOL.md`), with no assembler changes.
