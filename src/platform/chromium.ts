// §4.2/§4.3: the Chromium `Platform` implementation. This file (and
// gecko.ts/webkit.ts) is the only place allowed to import `browser`/`chrome`
// (CLAUDE.md boundaries) — everything else depends on `Platform`/`Transport`.
//
// §4.3.1: the offscreen document (the compute host) cannot call `tabs` APIs,
// so both directions of tab-bound messaging are relayed through the
// background service worker:
//   - content script -> background -> offscreen  (requests reaching the host)
//   - offscreen -> background -> tab              (pushes leaving the host)
// The relay and the host-side handler share one message shape (`EdwardMessage`)
// and use `sender.tab` (present only for messages that genuinely came from a
// tab) to tell an original request from an already-relayed one apart, so a
// broadcast a listener sent itself is never mistaken for new inbound work.
//
// §4.3 item 15 (new, found building M6): offscreen documents are even more
// restricted than that comment implies -- per Chrome's own docs, "only the
// chrome.runtime messaging APIs are exposed to the offscreen document" to
// discourage using it as a background-page replacement. `chrome.storage`,
// `chrome.permissions` and `chrome.tabs` are all unavailable there, not just
// `tabs`. `settings` (KeyValueStore) is relayed through background the same
// way tab-bound calls already are.

import { browser } from 'wxt/browser';
import { isTabPushMessage } from './messages';
import type { MessageMap, TabPushMessage } from './messages';
import type { KeyValueStore, Platform, Port, TabRef } from './types';
import { decodeBinary, encodeBinary } from './binaryCodec';

type EdwardMessage =
  | { __edward: 'request'; type: string; payload: unknown }
  | { __edward: 'to-tab'; tabId: number; msg: unknown }
  | { __edward: 'get-active-tab' }
  | { __edward: 'settings'; op: 'get' | 'set' | 'remove'; key: string; value?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEdwardMessage(value: unknown): value is EdwardMessage {
  return isRecord(value) && typeof value.__edward === 'string';
}

// Whether this context can call `tabs` APIs directly — true in the
// background service worker, false in the offscreen document (§4.3.1).
function canUseTabsApi(): boolean {
  return typeof browser.tabs?.sendMessage === 'function';
}

// True everywhere except the offscreen document (§4.3 item 15).
function canUseStorageApi(): boolean {
  return typeof browser.storage?.local?.get === 'function';
}

// Concurrent requests can each reach the relay before the offscreen document
// finishes being created; `browser.offscreen.createDocument` throws if called
// again while one already exists (or is being created), so the in-flight
// promise is memoized synchronously (before any `await`) rather than
// re-checking `hasDocument()` per call.
let ensureComputeHostPromise: Promise<void> | undefined;

function ensureComputeHost(): Promise<void> {
  ensureComputeHostPromise ??= (async () => {
    const hasDocument = await browser.offscreen.hasDocument();
    if (hasDocument) return;
    await browser.offscreen.createDocument({
      url: browser.runtime.getURL('/offscreen.html'),
      reasons: ['WORKERS'],
      justification: 'Runs the sanitization pipeline, models and agent loop off the main thread (SPEC §4.1).',
    });
  })();
  return ensureComputeHostPromise;
}

async function transportRequest<K extends keyof MessageMap['request']>(
  type: K,
  payload: MessageMap['request'][K]['request'],
): Promise<MessageMap['request'][K]['response']> {
  const message: EdwardMessage = { __edward: 'request', type: String(type), payload: encodeBinary(payload) };
  const response = (await browser.runtime.sendMessage(message)) as { ok: true; result: unknown } | { ok: false; error: string };
  if (!response.ok) throw new Error(response.error);
  return decodeBinary(response.result) as MessageMap['request'][K]['response'];
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
    if (canUseStorageApi()) {
      const result = await browser.storage.local.get(key);
      return result[key] as T | undefined;
    }
    const message: EdwardMessage = { __edward: 'settings', op: 'get', key };
    return (await browser.runtime.sendMessage(message)) as T | undefined;
  },
  async set<T>(key: string, value: T): Promise<void> {
    if (canUseStorageApi()) {
      await browser.storage.local.set({ [key]: value });
      return;
    }
    const message: EdwardMessage = { __edward: 'settings', op: 'set', key, value };
    await browser.runtime.sendMessage(message);
  },
  async remove(key: string): Promise<void> {
    if (canUseStorageApi()) {
      await browser.storage.local.remove(key);
      return;
    }
    const message: EdwardMessage = { __edward: 'settings', op: 'remove', key };
    await browser.runtime.sendMessage(message);
  },
};

async function getActiveTab(): Promise<TabRef> {
  if (canUseTabsApi()) {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined || !tab.url) {
      throw new Error('active tab has no accessible id/url (activeTab permission not yet granted?)');
    }
    return { tabId: tab.id, url: tab.url };
  }
  const message: EdwardMessage = { __edward: 'get-active-tab' };
  const response = (await browser.runtime.sendMessage(message)) as TabRef;
  return response;
}

async function sendToTab(tabId: number, msg: unknown): Promise<unknown> {
  if (canUseTabsApi()) return browser.tabs.sendMessage(tabId, msg);
  const message: EdwardMessage = { __edward: 'to-tab', tabId, msg };
  return browser.runtime.sendMessage(message);
}

// Content-script side only. `sendToTab` (popup or, for 'stopTask', this same
// tab's own overlay) reaches this tab's content script directly via
// `browser.tabs.sendMessage`/relay -- never broadcast to other tabs or
// contexts -- so no `sender` filtering is needed here, unlike
// `onComputeHostRequest`'s relay-vs-original disambiguation.
function onTabPush(handler: (msg: TabPushMessage) => void): void {
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isTabPushMessage(message)) return false;
    handler(message);
    return false; // no response expected
  });
}

export function createChromiumPlatform(): Platform {
  return {
    name: 'chromium',
    transport: { request: transportRequest, connect: transportConnect },
    ensureComputeHost,
    settings,
    getActiveTab,
    sendToTab,
    onTabPush,
    async requestHostPermission(origin: string): Promise<boolean> {
      return browser.permissions.request({ origins: [origin] });
    },
    async ensureSiteAccess(): Promise<boolean> {
      // Checks only: <all_urls> isn't an optional permission on Chromium, so
      // it can't be requested -- the user changes it in Chrome's site access UI.
      return browser.permissions.contains({ origins: ['<all_urls>'] });
    },
    assetUrl(path: string): string {
      // WXT's generated `getURL` overloads only accept known entrypoint pages;
      // `assetUrl` must also resolve arbitrary bundled paths (e.g. future
      // public/models/* weights), so the stricter overload is bypassed here.
      return (browser.runtime.getURL as (path: string) => string)(path);
    },
    async openSettings(): Promise<void> {
      await browser.runtime.openOptionsPage();
    },
  };
}

// Registers the compute-host-side dispatch function. Called once by the
// offscreen document's entrypoint (`src/entrypoints/offscreen/main.ts`).
// Only handles messages relayed by the background router (`sender.tab`
// undefined) — an original content-script broadcast that happens to also
// reach this listener directly is ignored, so the background relay stays the
// single authority for routing (§4.3.1).
export function onComputeHostRequest(handler: (type: string, payload: unknown) => Promise<unknown>): void {
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isEdwardMessage(message) || message.__edward !== 'request' || sender.tab !== undefined) return false;
    void handler(message.type, decodeBinary(message.payload))
      .then((result) => sendResponse({ ok: true, result: encodeBinary(result) }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'unknown' }));
    return true; // keep the message channel open for the async sendResponse above
  });
}

// `browser.offscreen.createDocument()` resolves once the document exists, not
// once its module has finished loading and called `onComputeHostRequest()` --
// so the very first forward right after creation can race a listener that
// isn't registered yet ("Could not establish connection"). A few short
// retries absorb that one-time load gap without masking a real failure.
async function forwardToOffscreen(message: EdwardMessage): Promise<unknown> {
  const attempts = 5;
  const delayMs = 25;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await browser.runtime.sendMessage(message);
    } catch (error) {
      if (attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('unreachable');
}

// Router-only wiring for the background service worker (§3 architecture:
// "BACKGROUND (router only)"). Relays content-script requests to the
// offscreen document (creating it on demand) and offscreen's tab-bound
// pushes back out to the right tab.
export function startBackgroundRelay(): void {
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isEdwardMessage(message)) return false;

    if (message.__edward === 'request') {
      if (sender.tab === undefined) return false; // not from a tab — not this relay's job
      void (async () => {
        await ensureComputeHost();
        return forwardToOffscreen(message) as Promise<{ ok: true; result: unknown } | { ok: false; error: string }>;
      })()
        .then(sendResponse)
        .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'unknown' }));
      return true;
    }

    if (message.__edward === 'to-tab') {
      void browser.tabs
        .sendMessage(message.tabId, message.msg)
        .then(sendResponse)
        .catch(() => sendResponse(undefined));
      return true;
    }

    if (message.__edward === 'get-active-tab') {
      void getActiveTab()
        .then(sendResponse)
        .catch(() => sendResponse(undefined));
      return true;
    }

    if (message.__edward === 'settings') {
      void (async () => {
        if (message.op === 'get') return (await browser.storage.local.get(message.key))[message.key];
        if (message.op === 'set') return browser.storage.local.set({ [message.key]: message.value });
        return browser.storage.local.remove(message.key);
      })()
        .then(sendResponse)
        .catch(() => sendResponse(undefined));
      return true;
    }

    return false;
  });
}
