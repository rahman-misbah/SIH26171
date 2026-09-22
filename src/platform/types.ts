// §4.2: the one interface every browser-family implementation (chromium.ts,
// gecko.ts, webkit.ts) satisfies. Nothing outside src/platform/ may import
// `browser`/`chrome` — everything else depends only on this interface.

import type { MessageMap, TabPushMessage } from './messages';

export interface TabRef {
  tabId: number;
  url: string;
}

export interface Port<Msg> {
  send(payload: Msg): void;
  onMessage(handler: (payload: Msg) => void): () => void; // returns an unsubscribe fn
  disconnect(): void;
}

// Messaging between content script, background and compute host (§4.3.1, §4.3.7).
export interface Transport {
  request<K extends keyof MessageMap['request']>(
    type: K,
    payload: MessageMap['request'][K]['request']
  ): Promise<MessageMap['request'][K]['response']>;
  connect<K extends keyof MessageMap['port']>(type: K): Port<MessageMap['port'][K]>;
}

// Wraps storage.local. Settings only — never content (§4.2).
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface Platform {
  readonly name: 'chromium' | 'gecko' | 'webkit';
  transport: Transport;
  // chromium: create the offscreen doc if absent; gecko/webkit: no-op.
  ensureComputeHost(): Promise<void>;
  settings: KeyValueStore;
  getActiveTab(): Promise<TabRef>;
  sendToTab<M>(tabId: number, msg: M): Promise<unknown>;
  // Content-script-only: registers this tab's listener for popup-initiated
  // start/stop pushes (§13.2, §4.3.5). A no-op call site elsewhere (popup,
  // compute host) would just never receive anything -- there's nothing to
  // push to them.
  onTabPush(handler: (msg: TabPushMessage) => void): void;
  captureVisibleTab?(tabId: number): Promise<Blob>; // optional fallback, rate-limited
  requestHostPermission(origin: string): Promise<boolean>; // for custom backend endpoints (§12.4)
  assetUrl(path: string): string; // runtime.getURL
  openSettings(): Promise<void>;
}
