// Side-effect module: import it FIRST in every model Worker, before the
// model library. ES modules evaluate their imports in order, so the guard
// (egressGuard.ts) is in place before the library's own module code -- or
// anything it schedules -- can make a request. A blocked attempt is reported
// to the provider (main thread) as a bare `egress-blocked` message, which
// the provider logs as a metric; the URL is never passed along (§11).

import { installEgressGuard, type GuardableScope } from './egressGuard';

// tsconfig's `lib` is DOM-only, so `self` types as Window; at runtime this is
// a DedicatedWorkerGlobalScope (same typing workaround as the workers).
installEgressGuard(self as unknown as GuardableScope, () => {
  (self as unknown as Worker).postMessage({ type: 'egress-blocked' });
});
