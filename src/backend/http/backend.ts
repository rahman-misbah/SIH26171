// §12.3: HttpAgentBackend -- for a custom agent server that owns its own
// prompting and planning. Speaks the Edward wire protocol
// (docs/WIRE_PROTOCOL.md):
//   GET  {endpoint}/v1/capabilities -> BackendCapabilities   (in init())
//   POST {endpoint}/v1/decide       -> AgentResponse          (in decide())
// Every request carries `Edward-Schema-Version`; a 426 means the server
// doesn't speak this version and the backend refuses to start.
//
// Capabilities come from the server, so they are only known after init().
// Until then this backend reports the most restrictive ones (no images), so
// anything that reads them early fails closed; the compute host calls
// init() before reading them (computeHost.ts).

import { isAgentResponse, type AgentResponse } from '@/agent/schema';
import type { AgentBackend, BackendCapabilities, SanitizedObservation } from '@/backend/types';
import { ReasonCodeError } from '@/logging';
import type { RuntimeLogger } from '@/logging';
import { parseHttpEndpoint } from './endpoint';
import { isBackendCapabilities, toWireObservation, WIRE_SCHEMA_VERSION } from './wire';

export const LOCKED_CAPABILITIES: BackendCapabilities = { maxImagesPerRequest: 0, maxImageBytes: 1, maxContextTokens: 1 };

// §12.6's LLM timeout, reused: a custom server that hasn't answered in 30 s
// is treated as failed (backend_error) rather than stalling the session.
const REQUEST_TIMEOUT_MS = 30_000;

export interface HttpBackendConfig {
  endpoint: string;
  token?: string; // §12.7: sent only as a Bearer header to this endpoint
}

export interface HttpAgentBackendDeps {
  logger: RuntimeLogger;
  loadConfig: () => Promise<HttpBackendConfig | undefined>;
}

interface Ready {
  endpoint: string;
  token?: string;
  capabilities: BackendCapabilities;
}

// Joins the caller's AbortSignal (session stop, §13.2) with a timeout, same
// approach as the openai-compatible client.
function combinedSignal(callerSignal: AbortSignal | undefined): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onCallerAbort = () => controller.abort();
  callerSignal?.addEventListener('abort', onCallerAbort);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    },
  };
}

// Status -> reason code. The server's own error body is never read or
// surfaced (CLAUDE.md: no library error messages in logs).
function failureFor(status: number): ReasonCodeError {
  if (status === 426) return new ReasonCodeError('backend_version_unsupported');
  if (status === 429) return new ReasonCodeError('backend_rate_limited');
  return new ReasonCodeError('backend_error');
}

export class HttpAgentBackend implements AgentBackend {
  readonly id = 'http:custom';
  private readonly deps: HttpAgentBackendDeps;
  private ready: Ready | undefined;
  private initPromise: Promise<void> | undefined;

  constructor(deps: HttpAgentBackendDeps) {
    this.deps = deps;
  }

  get capabilities(): BackendCapabilities {
    return this.ready?.capabilities ?? LOCKED_CAPABILITIES;
  }

  // Memoized: the compute host may call init() several times per step. A
  // failed init is forgotten, so the next call tries again.
  init(): Promise<void> {
    this.initPromise ??= this.connect().catch((error: unknown) => {
      this.initPromise = undefined;
      throw error;
    });
    return this.initPromise;
  }

  private async connect(): Promise<void> {
    const config = await this.deps.loadConfig();
    const endpoint = config ? parseHttpEndpoint(config.endpoint) : undefined;
    if (!config || !endpoint) throw new ReasonCodeError('backend_error', 'http endpoint missing or not allowed');

    const body = await this.request(`${endpoint}/v1/capabilities`, { method: 'GET' }, config.token, undefined);
    if (!isBackendCapabilities(body)) throw new ReasonCodeError('backend_error', 'malformed capabilities');

    this.ready = { endpoint, token: config.token, capabilities: body };
  }

  async decide(obs: SanitizedObservation, signal?: AbortSignal): Promise<AgentResponse> {
    const ready = this.ready;
    if (!ready) throw new ReasonCodeError('backend_error', 'HttpAgentBackend.decide() called before init()');

    let body: unknown;
    try {
      body = await this.request(
        `${ready.endpoint}/v1/decide`,
        { method: 'POST', body: JSON.stringify(toWireObservation(obs)) },
        ready.token,
        signal,
      );
    } catch (error) {
      // A 426 mid-session means the server changed under us: forget the
      // connection so the next step's init() checks the version again.
      if (error instanceof ReasonCodeError && error.reason === 'backend_version_unsupported') {
        this.ready = undefined;
        this.initPromise = undefined;
      }
      throw error;
    }

    // No retry on an invalid reply, unlike the LLM backend (§12.2): the
    // server owns its prompting, so asking again the same way wouldn't help.
    // §13.1: a final invalid response ends the session.
    if (!isAgentResponse(body)) {
      this.logValidate(obs, 'fail');
      throw new ReasonCodeError('backend_invalid_response');
    }
    this.logValidate(obs, 'ok');
    return body;
  }

  // Returns the parsed JSON body, or undefined if it isn't JSON (the caller's
  // type guard then rejects it). The timeout covers reading the body too.
  private async request(url: string, init: RequestInit, token: string | undefined, callerSignal: AbortSignal | undefined): Promise<unknown> {
    const { signal, cleanup } = combinedSignal(callerSignal);
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          'Edward-Schema-Version': WIRE_SCHEMA_VERSION,
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal,
        // Never follow a redirect: the observation must reach only the
        // endpoint the user configured (and was granted permission for).
        redirect: 'error',
      });
      if (!res.ok) throw failureFor(res.status);
      return await res.json().catch(() => undefined);
    } catch (error) {
      if (error instanceof ReasonCodeError) throw error;
      if (callerSignal?.aborted) throw error; // session stopped: propagate the abort as-is
      throw new ReasonCodeError('backend_error');
    } finally {
      cleanup();
    }
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
