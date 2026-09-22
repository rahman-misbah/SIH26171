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
    statusEl.textContent = 'No active tab to run on.';
  }
}

startButton.addEventListener('click', () => {
  const task = taskInput.value.trim();
  if (!task) {
    statusEl.textContent = 'Enter a task first.';
    return;
  }
  statusEl.textContent = 'Started -- see the on-page status.';
  void push({ type: 'startTask', task });
});

stopButton.addEventListener('click', () => {
  statusEl.textContent = 'Stopping...';
  void push({ type: 'stopTask' });
});
