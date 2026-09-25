// Injected by wxt.config.ts's `vite.define` -- true only for `test:e2e`
// builds (see tests/e2e/ping.spec.ts). Always false, and dead-code-eliminated,
// in `dev`/`build`.
declare const __EDWARD_E2E__: boolean;

// M10: benchmark-only compute override (wxt.config.ts). null in every build
// except `EDWARD_E2E=1 EDWARD_FORCE_COMPUTE=wasm|webgpu`.
declare const __EDWARD_FORCE_COMPUTE__: 'webgpu' | 'wasm' | null;
