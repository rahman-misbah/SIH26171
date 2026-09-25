import path from 'node:path';
import { chromium, test as base, type BrowserContext } from '@playwright/test';

// Playwright's documented pattern for loading an unpacked extension
// (https://playwright.dev/docs/chrome-extensions). MV3 extension service workers
// require a headed context; this is a documented Chromium/Playwright limitation
// for M1, not a workaround we invented.
const EXTENSION_PATH = path.resolve(import.meta.dirname, '../../.output/chrome-mv3');

export const E2E_PUBLIC_HOST = 'xo.edward.test';

// Launches Chromium with the built extension. `userDataDir` '' is a fresh
// temporary profile; tests/bench/faceRecall.spec.ts passes a real directory
// so settings survive a browser restart.
export function launchExtensionContext(userDataDir = ''): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      // M9: the image fetch fallback refuses private hosts (127.0.0.1
      // included), so images.spec.ts reaches its second local server
      // through a public-looking name instead. `.test` is reserved (RFC
      // 2606) and never resolves on the real internet.
      `--host-resolver-rules=MAP ${E2E_PUBLIC_HOST} 127.0.0.1`,
      // M10 benchmark (scripts/benchmark.ts): WebGPU is off by default in
      // Chrome on Linux. With both flags Chrome exposes the real (Vulkan)
      // adapter; --enable-unsafe-webgpu alone gives SwiftShader, a CPU
      // emulator that would pass for a GPU.
      ...(process.env.EDWARD_FORCE_COMPUTE === 'webgpu' ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan'] : []),
    ],
  });
}

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await launchExtensionContext();
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    await use(worker.url().split('/')[2] ?? '');
  },
});

export { expect } from '@playwright/test';
