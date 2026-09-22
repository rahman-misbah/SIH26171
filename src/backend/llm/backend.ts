// §12.2: LlmAgentBackend -- one generic implementation for every LLM vendor.
// `capabilities` must be known synchronously (the AgentBackend interface
// marks it `readonly`), but the actual ModelClient needs a settings-store
// read for its API key, which is only possible asynchronously -- so
// `capabilities` is a plain constant supplied by the caller (backends.config
// .ts, per provider), while the client and system prompt are built lazily
// inside init(), the one async lifecycle hook the contract gives us for
// exactly this ("validate config... prompt loaded", SPEC §12.1).

import { buildModelRequest } from './serialize';
import { parseAgentResponse } from './parseResponse';
import type { ModelClient, ModelRequest } from './types';
import type { AgentResponse } from '@/agent/schema';
import type { AgentBackend, BackendCapabilities, SanitizedObservation } from '@/backend/types';
import { ReasonCodeError } from '@/logging';
import type { RuntimeLogger } from '@/logging';

const RETRY_NOTE =
  'Your previous reply was not valid JSON matching the required response schema. Reply again with only the JSON object described in the system prompt.';

export interface LlmAgentBackendDeps {
  id: string;
  capabilities: BackendCapabilities;
  logger: RuntimeLogger;
  loadSystemPrompt: () => Promise<string>;
  loadClient: () => Promise<ModelClient>;
}

export class LlmAgentBackend implements AgentBackend {
  readonly id: string;
  readonly capabilities: BackendCapabilities;
  private readonly deps: LlmAgentBackendDeps;
  private client: ModelClient | undefined;
  private systemPrompt: string | undefined;

  constructor(deps: LlmAgentBackendDeps) {
    this.id = deps.id;
    this.capabilities = deps.capabilities;
    this.deps = deps;
  }

  async init(): Promise<void> {
    this.client ??= await this.deps.loadClient();
    this.systemPrompt ??= await this.deps.loadSystemPrompt();
  }

  async decide(obs: SanitizedObservation, signal?: AbortSignal): Promise<AgentResponse> {
    if (!this.client || this.systemPrompt === undefined) {
      throw new ReasonCodeError('backend_error', 'LlmAgentBackend.decide() called before init()');
    }
    const client = this.client;
    const systemPrompt = this.systemPrompt;

    const attempt = async (extraNote?: string): Promise<AgentResponse | undefined> => {
      const base = buildModelRequest(obs, systemPrompt);
      const req: ModelRequest = extraNote ? { ...base, items: [...base.items, { kind: 'text', text: extraNote }] } : base;
      const raw = await client.generate(req, signal);
      return parseAgentResponse(raw.text);
    };

    const first = await attempt();
    if (first) {
      this.logValidate(obs, 'ok');
      return first;
    }

    // §12.2: one retry with a short error note on invalid output.
    const retried = await attempt(RETRY_NOTE);
    if (retried) {
      this.logValidate(obs, 'ok');
      return retried;
    }

    this.logValidate(obs, 'fail');
    throw new ReasonCodeError('backend_invalid_response');
  }

  private logValidate(obs: SanitizedObservation, outcome: 'ok' | 'fail'): void {
    const now = performance.timeOrigin + performance.now();
    this.deps.logger.record({
      session_id: obs.session_id,
      step: obs.step,
      op: 'action.validate',
      t_start: now,
      t_end: now,
      duration_ms: 0,
      outcome,
      reason: outcome === 'fail' ? 'backend_invalid_response' : undefined,
    });
  }
}
