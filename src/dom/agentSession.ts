// §13.2 (content-script half) + §4.3.5: drives one tab's agent session --
// popup start/stop pushes (Platform.onTabPush), the per-step loop (Phase
// A/B -> sanitizeChunk -> agentDecide -> execute -> report -> settle), and
// the status overlay. The compute host (src/agent/loop.ts, via
// src/core/computeHost.ts) owns session/policy/token-map state; this file
// owns the DOM reads, action execution and the `for step in 1..MAX_STEPS`
// iteration itself, because only the content script can do either (§3).

import { buildStepObservation } from './observe';
import { createOverlay } from './overlay';
import { executeAction } from './executor';
import { waitForSettle } from './waitForSettle';
import { MAX_STEPS } from '@/agent/loop';
import type { ActionResult } from '@/agent/schema';
import { getBackendSettings } from '@/backend';
import type { Platform } from '@/platform/types';

// Also the direct entry point the e2e suite's __EDWARD_E2E__-gated hook in
// src/entrypoints/content.ts calls (tests/e2e/agentLoop.spec.ts) -- driving
// this the same way the real popup does (via onTabPush) instead of faking a
// cross-world message, since Playwright's page.evaluate runs in the page's
// main world, not the content script's isolated one.
export interface AgentSessionHandle {
  startTask(task: string): void;
  stopTask(): void;
}

function describeFailure(reason: string): string {
  return `stopped: ${reason}`;
}

export function attachAgentSession(platform: Platform, doc: Document): AgentSessionHandle {
  let running: { session_id: string; stopRequested: boolean } | undefined;

  function startTask(task: string): void {
    if (running) return; // one session per tab at a time
    const state = { session_id: crypto.randomUUID(), stopRequested: false };
    running = state;
    void runSession(task, state).finally(() => {
      if (running === state) running = undefined;
    });
  }

  async function runSession(task: string, state: { session_id: string; stopRequested: boolean }): Promise<void> {
    const { session_id } = state;
    const overlay = createOverlay();
    overlay.onStop(() => {
      state.stopRequested = true;
    });
    overlay.setStatus({ running: true, thought: 'starting...' });

    const backendSettings = await getBackendSettings(platform.settings);
    const backend_id = backendSettings.selectedBackendId;
    const origin = doc.location.origin;

    try {
      for (let step = 1; step <= MAX_STEPS && !state.stopRequested; step++) {
        const built = await buildStepObservation(platform.transport, doc, { session_id, step, task, origin, backend_id });

        const decideResult = await platform.transport.request('agentDecide', {
          session_id,
          step,
          task: built.task,
          page: built.page,
          skeleton: built.skeleton,
          contentResults: built.contentResults,
          origin,
          backend_id,
        });

        if (decideResult.status !== 'ok') {
          overlay.setStatus({
            step,
            running: false,
            thought: decideResult.status === 'blocked' ? describeFailure('privacy guard triggered') : describeFailure(decideResult.reason),
          });
          return;
        }

        overlay.setStatus({ step, running: true, thought: decideResult.thought });

        const results: ActionResult[] = [];
        for (const action of decideResult.resolvedActions) {
          if (action.type === 'wait') {
            await new Promise((resolve) => setTimeout(resolve, action.ms));
            results.push('ok');
            continue;
          }
          const result = executeAction(built.registry, action);
          results.push(result);
          // §13.2: "if result != ok or page navigated: break" -- a successful
          // navigate leaves this document behind, so nothing after it runs either.
          if (result !== 'ok' || action.type === 'navigate') break;
        }

        await platform.transport.request('agentReportResults', { session_id, results });

        if (decideResult.done || state.stopRequested) {
          overlay.setStatus({ step, running: false, thought: decideResult.answer ?? decideResult.thought });
          return;
        }

        await waitForSettle();
      }
    } finally {
      await platform.transport.request('agentStop', { session_id }).catch(() => {
        // Best-effort: the session is ending either way.
      });
    }
  }

  function stopTask(): void {
    if (running) running.stopRequested = true;
  }

  platform.onTabPush((msg) => {
    if (msg.type === 'startTask') startTask(msg.task);
    else stopTask();
  });

  return { startTask, stopTask };
}
