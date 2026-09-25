import { defineConfig } from '@playwright/test';

// §15 benchmark (tests/bench), run by scripts/benchmark.ts -- kept out of
// `npm run test:e2e` because it needs a per-compute build.
export default defineConfig({
  testDir: 'tests/bench',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  projects: [{ name: 'chromium' }],
});
