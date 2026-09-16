import { defineConfig } from 'wxt';

// WXT defaults Firefox to MV2; the spec (SPEC.md §4.1) assumes MV3 everywhere
// (Firefox as an MV3 event page), so this is forced explicitly.
export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    // 'wasm-unsafe-eval' is required by onnxruntime-web / Tesseract.js / zxing-wasm (SPEC §4.3.3).
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    // The only fixed backend origin the extension talks to by default (SPEC §12.6).
    host_permissions: ['https://api.groq.com/*'],
    // Requested at runtime for custom backend origins (SPEC §12.4, §4.3.8).
    optional_host_permissions: ['https://*/*'],
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
    },
  }),
});
