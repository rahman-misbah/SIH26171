import { expect, test } from './fixtures';

// Proves `npm run test:e2e` actually exercises the unpacked build (M1). Real behavior
// (content script <-> compute host ping round-trip) arrives in M3.
test('extension loads and registers a background service worker', async ({ extensionId }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
});
