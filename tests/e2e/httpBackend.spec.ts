// M11 Done-when: "Mock custom server drives one agent step" (§12.3). The
// extension is switched to the http backend through its settings, and a
// mock server on localhost (mockAgentServer.ts) does the planning. Proves
// the wire protocol end to end: version header, capabilities discovery, the
// observation on the wire, and the returned action executed on the page
// through the same §13.4 policy + token resolution as every other backend.

import path from 'node:path';
import type { Page } from '@playwright/test';
import { loadCanaries } from '../fixtures/loadCanaries';
import { expect, test } from './fixtures';
import { startMockAgentServer } from './mockAgentServer';
import { startStaticServer } from './staticServer';

const FIXTURES_ROOT = path.resolve(import.meta.dirname, '../fixtures');
const TASK_EMAIL = 'alice.agent.canary@example.com';

async function seedBackend(page: Page, settings: unknown): Promise<void> {
  await page.evaluate((json) => {
    document.documentElement.dataset.edwardE2eSeedBackend = json;
  }, JSON.stringify(settings));
  await page.waitForFunction(() => document.documentElement.dataset.edwardE2eSeedBackend === undefined, undefined, { timeout: 5_000 });
}

test('a custom agent server drives one agent step over the wire protocol', async ({ context }) => {
  const site = await startStaticServer(FIXTURES_ROOT);
  const agent = await startMockAgentServer();
  try {
    const page = await context.newPage();
    await page.goto(`${site.url}pages/agent-form.html`);
    // Readiness gate: the content script's own discovery observation.
    await page.waitForFunction(() => document.documentElement.dataset.edwardObservation, undefined, { timeout: 10_000 });

    await seedBackend(page, { selectedBackendId: 'http:custom', llm: {}, http: { endpoint: agent.endpoint, token: 'e2e-token' } });
    await page.evaluate((task) => {
      document.documentElement.dataset.edwardE2eStartTask = task;
    }, `Fill in the email field with ${TASK_EMAIL}`);

    // The server's action, executed on the real page: the token it sent back
    // was resolved to the email only inside the extension.
    await expect(page.locator('#email')).toHaveValue(TASK_EMAIL, { timeout: 15_000 });

    // Step 2 (the server answers done) may still be in flight.
    await expect.poll(() => agent.requests.filter((r) => r.path === '/v1/decide').length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    const decides = agent.requests.filter((r) => r.path === '/v1/decide');

    // Capabilities first, every request versioned and authorised.
    expect(agent.requests[0]).toMatchObject({ method: 'GET', path: '/v1/capabilities' });
    for (const r of agent.requests) {
      expect(r.headers['edward-schema-version']).toBe('1');
      expect(r.headers.authorization).toBe('Bearer e2e-token');
    }

    // The body is a SanitizedObservation: the task went out tokenized.
    const first = JSON.parse(decides[0]!.body) as { schema_version: string; task: string; history: unknown[] };
    expect(first.schema_version).toBe('1');
    expect(first.task).toMatch(/\[PII_EMAIL_\d+\]/);
    expect(first.history).toEqual([]);
    // Step 2 carries step 1's result, so the server can see its action ran.
    const second = JSON.parse(decides[1]!.body) as { history: { results: string[] }[] };
    expect(second.history[0]?.results).toEqual(['ok']);

    // Nothing sensitive crossed the wire: not the task's email, no canary.
    const wire = agent.requests.map((r) => r.body).join('\n');
    expect(wire).not.toContain(TASK_EMAIL);
    for (const canary of loadCanaries()) expect(wire, canary.id).not.toContain(canary.value);

    await page.close();
  } finally {
    await agent.close();
    await site.close();
  }
});
