// §12.3: HttpAgentBackend against a stubbed fetch. The real-server path is
// covered by tests/e2e/httpBackend.spec.ts (a mock server on localhost).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpAgentBackend, LOCKED_CAPABILITIES } from '@/backend/http/backend';
import type { SanitizedObservation } from '@/backend/types';
import { createLogger, ReasonCodeError } from '@/logging';
import { createFakeSink } from '../../logging/fakeSink';

const CAPS = { maxImagesPerRequest: 2, maxImageBytes: 1_000_000, maxContextTokens: 8192 };
const VALID = { thought: 'ok', done: true, actions: [] };

function obs(): SanitizedObservation {
  return {
    schema_version: '1',
    session_id: 's1',
    step: 1,
    task: 't',
    page: { url: 'https://example.com/', title: 'x', viewport: { w: 1, h: 1 }, scroll: { x: 0, y: 0 } },
    dom: [],
    images: [],
    history: [],
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Routes by path: /v1/capabilities -> capsResponse, /v1/decide -> decideResponses in order.
function stubServer(capsResponse: () => Response, ...decideResponses: (() => Response)[]) {
  const queue = [...decideResponses];
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.endsWith('/v1/capabilities')) return capsResponse();
    const next = queue.shift();
    if (!next) throw new Error('unexpected request');
    return next();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function backend(config: { endpoint: string; token?: string } = { endpoint: 'https://agent.example.com', token: 'secret' }) {
  const sink = createFakeSink();
  const logger = createLogger(sink);
  return { backend: new HttpAgentBackend({ logger, loadConfig: async () => config }), sink, logger };
}

async function reasonOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof ReasonCodeError ? error.reason : 'not-a-reason-code';
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HttpAgentBackend init()', () => {
  it('has the most restrictive capabilities (no images) until init() succeeds', () => {
    const { backend: b } = backend();
    expect(b.id).toBe('http:custom');
    expect(b.capabilities).toEqual(LOCKED_CAPABILITIES);
    expect(LOCKED_CAPABILITIES.maxImagesPerRequest).toBe(0);
  });

  it('fetches capabilities from GET {endpoint}/v1/capabilities, sending the schema version and token', async () => {
    const fetchMock = stubServer(() => json(200, CAPS));
    const { backend: b } = backend();
    await b.init();
    expect(b.capabilities).toEqual(CAPS);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://agent.example.com/v1/capabilities');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Edward-Schema-Version']).toBe('1');
    expect(headers.Authorization).toBe('Bearer secret');
  });

  it('sends no Authorization header when no token is set', async () => {
    const fetchMock = stubServer(() => json(200, CAPS));
    const { backend: b } = backend({ endpoint: 'https://agent.example.com' });
    await b.init();
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('refuses to start on 426 (unsupported schema_version)', async () => {
    stubServer(() => json(426, {}));
    const { backend: b } = backend();
    expect(await reasonOf(b.init())).toBe('backend_version_unsupported');
    expect(b.capabilities).toEqual(LOCKED_CAPABILITIES);
  });

  it('refuses to start on malformed capabilities', async () => {
    stubServer(() => json(200, { maxImagesPerRequest: 'lots' }));
    const { backend: b } = backend();
    expect(await reasonOf(b.init())).toBe('backend_error');
  });

  it('refuses to start without an endpoint, or with a disallowed one, before any request', async () => {
    const fetchMock = stubServer(() => json(200, CAPS));
    const unconfigured = new HttpAgentBackend({ logger: createLogger(createFakeSink()), loadConfig: async () => undefined });
    expect(await reasonOf(unconfigured.init())).toBe('backend_error');
    expect(await reasonOf(backend({ endpoint: 'http://agent.example.com' }).backend.init())).toBe('backend_error');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches capabilities once, and retries after a failed init', async () => {
    let calls = 0;
    const fetchMock = stubServer(() => (++calls === 1 ? json(503, {}) : json(200, CAPS)));
    const { backend: b } = backend();
    expect(await reasonOf(b.init())).toBe('backend_error');
    await b.init();
    await b.init();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('HttpAgentBackend decide()', () => {
  it('POSTs the wire observation to {endpoint}/v1/decide and returns a valid AgentResponse', async () => {
    const fetchMock = stubServer(() => json(200, CAPS), () => json(200, VALID));
    const { backend: b } = backend();
    await b.init();
    await expect(b.decide(obs())).resolves.toEqual(VALID);
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('https://agent.example.com/v1/decide');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ schema_version: '1', session_id: 's1' });
  });

  it('fails with backend_invalid_response on an invalid reply, without retrying (§13.1)', async () => {
    const fetchMock = stubServer(() => json(200, CAPS), () => json(200, { thought: 'x' }));
    const { backend: b, sink, logger } = backend();
    await b.init();
    expect(await reasonOf(b.decide(obs()))).toBe('backend_invalid_response');
    expect(fetchMock).toHaveBeenCalledTimes(2); // capabilities + one decide
    await logger.flush();
    const validate = sink.records.find((r) => r.op === 'action.validate');
    expect(validate).toMatchObject({ outcome: 'fail', reason: 'backend_invalid_response' });
  });

  it('fails with backend_invalid_response on a non-JSON body', async () => {
    stubServer(() => json(200, CAPS), () => new Response('<html>', { status: 200 }));
    const { backend: b } = backend();
    await b.init();
    expect(await reasonOf(b.decide(obs()))).toBe('backend_invalid_response');
  });

  it('maps 429 to backend_rate_limited, 426 to backend_version_unsupported, other errors to backend_error', async () => {
    stubServer(
      () => json(200, CAPS),
      () => json(429, {}),
      () => json(426, {}),
      () => json(500, {}),
      () => {
        throw new TypeError('network down');
      },
    );
    const { backend: b } = backend();
    await b.init();
    expect(await reasonOf(b.decide(obs()))).toBe('backend_rate_limited');
    expect(await reasonOf(b.decide(obs()))).toBe('backend_version_unsupported');
    await b.init(); // 426 reset init; this re-fetches capabilities
    expect(await reasonOf(b.decide(obs()))).toBe('backend_error');
    expect(await reasonOf(b.decide(obs()))).toBe('backend_error');
  });

  it('refuses to decide before init()', async () => {
    const { backend: b } = backend();
    expect(await reasonOf(b.decide(obs()))).toBe('backend_error');
  });

  it('propagates a caller abort as-is', async () => {
    const controller = new AbortController();
    stubServer(
      () => json(200, CAPS),
      () => {
        controller.abort();
        throw new DOMException('aborted', 'AbortError');
      },
    );
    const { backend: b } = backend();
    await b.init();
    await expect(b.decide(obs(), controller.signal)).rejects.toSatisfy((e) => e instanceof DOMException && e.name === 'AbortError');
  });
});
