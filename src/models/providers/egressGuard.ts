// §1: "the extension's only network egress is (a) the backend call carrying
// the sanitized observation and (b) image re-fetches" -- never a model
// library phoning home. Found in /milestone-check for M8: MediaPipe Tasks
// Vision always creates a usage-metrics logger that POSTs to
// https://odml.pa.googleapis.com/v1/log every 60s (its README's Privacy
// Notice documents this; no public opt-out). Because the content script's
// <all_urls> match already grants the extension host access (SPEC §4.3
// item 16), nothing else would stop it.
//
// So every model Worker installs this guard before its library's module
// code runs: network APIs may only reach the extension's own origin (the
// bundled weights/wasm, §4.3.3) plus data:/blob: URLs, which never touch
// the network. Anything else is refused -- fail-closed, and library-
// agnostic, so it also covers any telemetry a future provider ships.
// (Remote *code* is already blocked separately by the extension CSP's
// `script-src 'self'`.)

// Compared as scheme + host rather than `URL.origin`: the WHATWG URL spec
// gives non-special schemes like `chrome-extension:`/`moz-extension:` an
// opaque ("null") origin, which browsers special-case but other runtimes
// (and the spec itself) don't -- scheme + host is unambiguous everywhere.
function schemeHost(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

import { ReasonCodeError } from '@/logging/logger';
import type { Logger, OpName } from '@/logging/schema';

export function isAllowedWorkerUrl(url: string, ownOrigin: string): boolean {
  try {
    const own = schemeHost(new URL(ownOrigin));
    const parsed = new URL(url, ownOrigin);
    if (parsed.protocol === 'data:') return true;
    // blob: URLs carry their creator's origin (blob:<origin>/<uuid>); only
    // our own are local to this extension.
    if (parsed.protocol === 'blob:') return schemeHost(new URL(parsed.pathname)) === own;
    return schemeHost(parsed) === own;
  } catch {
    return false; // unparseable -> refuse
  }
}

export interface GuardableScope {
  location: { origin: string };
  fetch: typeof fetch;
  XMLHttpRequest?: typeof XMLHttpRequest;
  WebSocket?: typeof WebSocket;
  EventSource?: typeof EventSource;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function refused(): TypeError {
  // A TypeError is what a real network failure looks like to fetch() callers,
  // so libraries take their normal "request failed" path (MediaPipe's metrics
  // logger then stops its flush timer and drops the batch).
  return new TypeError('network egress blocked by the model-worker guard');
}

// `onBlocked` must not receive the URL: it's only ever used to log a metric
// (§11: no URLs in logs).
export function installEgressGuard(scope: GuardableScope, onBlocked: () => void): void {
  const own = scope.location.origin;
  const allowed = (url: string | URL): boolean => isAllowedWorkerUrl(String(url), own);

  const realFetch = scope.fetch.bind(scope);
  scope.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!allowed(urlOf(input))) {
      onBlocked();
      return Promise.reject(refused());
    }
    return realFetch(input, init);
  };

  const Xhr = scope.XMLHttpRequest;
  if (Xhr) {
    const realOpen = Xhr.prototype.open;
    Xhr.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      if (!allowed(url)) {
        onBlocked();
        throw refused();
      }
      return (realOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof Xhr.prototype.open;
  }

  const Ws = scope.WebSocket;
  if (Ws) {
    scope.WebSocket = class extends Ws {
      constructor(url: string | URL, protocols?: string | string[]) {
        if (!allowed(url)) {
          onBlocked();
          throw refused();
        }
        super(url, protocols);
      }
    };
  }

  const Es = scope.EventSource;
  if (Es) {
    scope.EventSource = class extends Es {
      constructor(url: string | URL, init?: EventSourceInit) {
        if (!allowed(url)) {
          onBlocked();
          throw refused();
        }
        super(url, init);
      }
    };
  }
}

// Provider-side (main thread): logs one blocked attempt as a metric -- op +
// model id + reason code only, never the URL (§11). ModelProvider's ctx only
// exposes Logger.timed(), so the attempt is recorded as a timed no-op that
// fails with the ReasonCode, which is exactly what timed() logs for a
// ReasonCodeError; the error is swallowed here (nothing to propagate -- the
// request was already refused inside the worker).
export function logEgressBlocked(logger: Logger, meta: { session_id: string; op: OpName; model_id: string }): void {
  void logger
    .timed(meta.op, { session_id: meta.session_id, model_id: meta.model_id, reason: 'egress_blocked' }, () =>
      Promise.reject(new ReasonCodeError('egress_blocked')),
    )
    .catch(() => {});
}
