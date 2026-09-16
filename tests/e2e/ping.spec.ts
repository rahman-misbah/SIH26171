import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from './fixtures';

// SPEC §4.3.1 round trip: content script -> background -> offscreen document
// (compute host) -> content script, proven via the __EDWARD_E2E__-gated hook
// in src/entrypoints/content.ts (see wxt.config.ts for why this is safe to
// ship: dead-code-eliminated in every other build). `<all_urls>` content
// scripts don't run on about:blank/data: URLs, so this serves a tiny page
// over a real local http:// origin instead.
async function startTestServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><html><body>edward ping fixture</body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => {
      // The browser keeps its keep-alive socket open, so a plain close()
      // would hang waiting for a connection nothing is going to end.
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test('content script <-> compute host ping round trip, plain and 1 MB binary', async ({ context }) => {
  const server = await startTestServer();
  try {
    const page = await context.newPage();
    await page.goto(server.url);

    const pingMs = await page.waitForFunction(
      () => document.documentElement.dataset.edwardPingMs,
      undefined,
      { timeout: 10_000 },
    );
    const pingBinMs = await page.waitForFunction(
      () => document.documentElement.dataset.edwardPingBinMs,
      undefined,
      { timeout: 10_000 },
    );

    const plainDuration = Number(await pingMs.jsonValue());
    const binaryDuration = Number(await pingBinMs.jsonValue());

    expect(plainDuration).toBeGreaterThanOrEqual(0);
    expect(binaryDuration).toBeGreaterThanOrEqual(0);

    // Recorded here for the M3 Log entry ("measured round-trip time for a 1 MB
    // binary payload on Chromium", SPEC MILESTONES.md M3 done-when).
    test.info().annotations.push({
      type: 'measurement',
      description: `1 MB binary ping round trip: ${binaryDuration.toFixed(2)} ms (plain ping: ${plainDuration.toFixed(2)} ms)`,
    });
  } finally {
    await server.close();
  }
});
