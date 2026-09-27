import { defineConfig } from 'wxt';

function forcedCompute(): 'webgpu' | 'wasm' | null {
  const value = process.env.EDWARD_FORCE_COMPUTE;
  if (process.env.EDWARD_E2E !== '1' || value === undefined || value === '') return null;
  if (value === 'webgpu' || value === 'wasm') return value;
  throw new Error(`EDWARD_FORCE_COMPUTE must be 'webgpu' or 'wasm', got '${value}'`);
}

export default defineConfig({
  srcDir: 'src',
  // WXT defaults Firefox to MV2; the spec (SPEC.md §4.1) assumes MV3 everywhere
  // (Firefox as an MV3 event page), so this is forced explicitly.
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    // 'wasm-unsafe-eval' is required by onnxruntime-web / Tesseract.js / zxing-wasm (SPEC §4.3.3).
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    // The fixed backend origins of the known LLM vendors (SPEC §12.4, §12.6;
    // OpenRouter added in M12, §0.1 F11). Custom endpoints are requested at runtime.
    host_permissions: ['https://api.groq.com/*', 'https://openrouter.ai/*'],
    // Requested at runtime for custom backend origins (SPEC §12.4, §4.3.8).
    // Plain http only on the local machine, for a development agent server
    // (§12.4, M11); match patterns without a port match every port.
    optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
    // 'offscreen' backs the Chromium compute host (SPEC §4.1) and is Chromium-only —
    // Firefox has no offscreen API and warns on the unrecognized permission if included.
    // 'storage' backs the settings store on every browser.
    // 'activeTab' backs Platform.getActiveTab()/sendToTab() (SPEC §4.2) — least-privilege
    // (only the user-gesture-activated tab), not the broader 'tabs' permission.
    permissions:
      browser === 'firefox' ? ['storage', 'activeTab'] : ['offscreen', 'storage', 'activeTab'],
    // Named 'settings' (not WXT's default 'options') to match SPEC/CLAUDE.md terminology throughout.
    options_ui: {
      page: 'settings.html',
      open_in_tab: true,
    },
  }),
  vite: () => ({
    define: {
      // Compile-time-only content-script self-test hook (tests/e2e/ping.spec.ts).
      // False (and dead-code-eliminated) for `dev`/`build`; true only when
      // `test:e2e` sets EDWARD_E2E=1, so the real extension never ships it.
      __EDWARD_E2E__: JSON.stringify(process.env.EDWARD_E2E === '1'),
      // M10 benchmark-only compute override (src/hw/detect.ts). Honoured only
      // in e2e builds, so a stray env var can't change a real build.
      __EDWARD_FORCE_COMPUTE__: JSON.stringify(forcedCompute()),
    },
  }),
});
