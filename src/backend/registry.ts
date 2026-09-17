// §12.4: lazy singleton per backend id, so repeated getBackend() calls in the
// same session reuse one instance (and, for MockAgentBackend, one observations
// array) instead of constructing a fresh backend per call.

import { backendFactories } from './backends.config';
import type { AgentBackend } from './types';

const instances = new Map<string, AgentBackend>();

export function getBackend(id: string = 'mock'): AgentBackend {
  const existing = instances.get(id);
  if (existing) return existing;

  const factory = backendFactories[id];
  if (!factory) throw new Error(`unknown backend id: ${id}`);

  const backend = factory();
  instances.set(id, backend);
  return backend;
}
