// backends.config.ts's llm:* factories need a settings store, a logger and
// assetUrl() to lazily build a client/load the system prompt inside
// AgentBackend.init() -- but getBackend(id) (§12.4) is a synchronous,
// zero-dependency lookup by design, so these can't be constructor
// parameters threaded through the registry. Configured once by
// bootstrapComputeHost() before any task can call getBackend('llm:*');
// mirrors the module-singleton pattern src/platform/index.ts already uses
// for the cached Platform instance.

import type { RuntimeLogger } from '@/logging';
import type { KeyValueStore } from '@/platform/types';

export interface BackendDeps {
  settings: KeyValueStore;
  logger: RuntimeLogger;
  assetUrl: (path: string) => string;
}

let deps: BackendDeps | undefined;

export function configureBackendDeps(next: BackendDeps): void {
  deps = next;
}

export function getBackendDeps(): BackendDeps {
  if (!deps) throw new Error('backend deps not configured -- bootstrapComputeHost() must run before getBackend()');
  return deps;
}

// Lenient variant for 'mock' (backends.config.ts): unlike llm:*, MockAgentBackend
// works fine with no deps at all (unit tests construct it with zero args), so
// its factory must not throw just because bootstrapComputeHost() hasn't run.
export function tryGetBackendDeps(): BackendDeps | undefined {
  return deps;
}
