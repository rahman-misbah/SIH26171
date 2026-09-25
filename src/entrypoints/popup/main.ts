// §4.3.5/§13.2: "the popup closes on blur in every browser, so it only
// starts/stops a task" -- live status is the content-script overlay
// (src/dom/overlay.ts), not this page.

import { getPlatform } from '@/platform';
import type { TabPushMessage } from '@/platform/messages';

const platform = getPlatform();

const taskInput = document.getElementById('task') as HTMLTextAreaElement;
const startButton = document.getElementById('start') as HTMLButtonElement;
const stopButton = document.getElementById('stop') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

async function push(msg: TabPushMessage): Promise<void> {
  try {
    const tab = await platform.getActiveTab();
    await platform.sendToTab(tab.tabId, msg);
  } catch {
    // Also what happens right after site access was first granted: a tab
    // that was already open may not have the content script yet.
    statusEl.textContent = 'Edward is not running on this page. Reload it and press Start again.';
  }
}

startButton.addEventListener('click', () => {
  const task = taskInput.value.trim();
  if (!task) {
    statusEl.textContent = 'Enter a task first.';
    return;
  }
  // §4.3.8: without site access the content script can't run, so the agent
  // doesn't start. Called before any await (Firefox's user-gesture rule).
  const access = platform.ensureSiteAccess().catch(() => false);
  void (async () => {
    if (!(await access)) {
      statusEl.textContent = 'Edward needs access to websites to run. Allow it and press Start again.';
      return;
    }
    statusEl.textContent = 'Started -- see the on-page status.';
    await push({ type: 'startTask', task });
  })();
});

stopButton.addEventListener('click', () => {
  statusEl.textContent = 'Stopping...';
  void push({ type: 'stopTask' });
});
