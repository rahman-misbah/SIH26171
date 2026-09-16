import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    // tests/e2e is Playwright's, run via `npm run test:e2e`, not Vitest.
    include: ['tests/unit/**/*.test.ts'],
  },
});
