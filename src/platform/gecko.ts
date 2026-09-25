// §4.2/§4.3: the Firefox/gecko `Platform` implementation. Firefox has no
// offscreen-document API — the background event page *is* the compute host
// (§4.1), so unlike chromium.ts there is no relay hop: content-script
// requests reach `onComputeHostRequest`'s listener directly, and
// `sendToTab`/`getActiveTab` can always call `browser.tabs` straight away.
// Firefox/Safari also use structured clone for messaging, so no §4.3.7
// ArrayBuffer <-> base64 re-encoding is needed here.

import { browser } from 'wxt/browser';
import { isTabPushMessage } from './messages';
import type { MessageMap, TabPushMessage } from './messages';
import type { KeyValueStore, Platform, Port, TabRef } from './types';

async function transportRequest<K extends keyof MessageMap['request']>(
  type: K,
  payload: MessageMap['request'][K]['request'],
): Promise<MessageMap['request'][K]['response']> {
  const message = { type: String(type), payload };
  const response = (await browser.runtime.sendMessage(message)) as { ok: true; result: unknown } | { ok: false; error: string };
  if (!response.ok) throw new Error(response.error);
  return response.result as MessageMap['request'][K]['response'];
}

function transportConnect<K extends keyof MessageMap['port']>(type: K): Port<MessageMap['port'][K]> {
  const port = browser.runtime.connect({ name: String(type) });
  return {
    send(payload) {
      port.postMessage(payload);
    },
    onMessage(handler) {
      const listener = (message: unknown) => handler(message as MessageMap['port'][K]);
      port.onMessage.addListener(listener);
      return () => port.onMessage.removeListener(listener);
    },
    disconnect() {
      port.disconnect();
    },
  };
}

const settings: KeyValueStore = {
  async get<T>(key: string): Promise<T | undefined> {
    const result = await browser.storage.local.get(key);
    return result[key] as T | undefined;
  },
  async set<T>(key: string, value: T): Promise<void> {
    await browser.storage.local.set({ [key]: value });
  },
  async remove(key: string): Promise<void> {
    await browser.storage.local.remove(key);
  },
};

async function getActiveTab(): Promise<TabRef> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url) {
    throw new Error('active tab has no accessible id/url (activeTab permission not yet granted?)');
  }
  return { tabId: tab.id, url: tab.url };
}

// Content-script side only, same message shape/behaviour as chromium.ts's
// (no relay hop here either -- see this file's header comment).
function onTabPush(handler: (msg: TabPushMessage) => void): void {
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isTabPushMessage(message)) return false;
    handler(message);
    return false;
  });
}

export function createGeckoPlatform(): Platform {
  return {
    name: 'gecko',
    transport: { request: transportRequest, connect: transportConnect },
    async ensureComputeHost(): Promise<void> {
      // No-op: the background event page is already the compute host (§4.1).
    },
    settings,
    getActiveTab,
    async sendToTab(tabId: number, msg: unknown): Promise<unknown> {
      return browser.tabs.sendMessage(tabId, msg);
    },
    onTabPush,
    async requestHostPermission(origin: string): Promise<boolean> {
      return browser.permissions.request({ origins: [origin] });
    },
    // Not `async`: permissions.request() has to be called synchronously
    // within the click that triggered it, or Firefox rejects it for lacking a
    // user gesture. It resolves true straight away, with no prompt, when
    // access is already granted.
    ensureSiteAccess(): Promise<boolean> {
      return browser.permissions.request({ origins: ['<all_urls>'] });
    },
    assetUrl(path: string): string {
      return (browser.runtime.getURL as (path: string) => string)(path);
    },
    async openSettings(): Promise<void> {
      await browser.runtime.openOptionsPage();
    },
  };
}

// The background page is the compute host on Firefox, so it registers this
// listener directly — no relay hop, no `sender.tab` filtering (§4.3.1 only
// applies to Chromium's offscreen-document restriction).
export function onComputeHostRequest(handler: (type: string, payload: unknown) => Promise<unknown>): void {
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (typeof message !== 'object' || message === null || !('type' in message)) return false;
    const { type, payload } = message as { type: string; payload: unknown };
    void handler(type, payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'unknown' }));
    return true;
  });
}

// No-op on Firefox/Safari: there is no background/offscreen split to relay
// between (kept only so background.ts can call it uniformly).
export function startBackgroundRelay(): void {
  // Intentionally empty.
}
