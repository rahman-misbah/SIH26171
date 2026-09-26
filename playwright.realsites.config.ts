import { defineConfig } from '@playwright/test';

// M12 real-site pass (tests/realsites), run by scripts/realSites.ts -- kept
// out of `npm run test:e2e` because it depends on the live internet.
export default defineConfig({
  testDir: 'tests/realsites',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  projects: [{ name: 'chromium' }],
});
