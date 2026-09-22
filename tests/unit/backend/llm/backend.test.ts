// §12.2: LlmAgentBackend's retry-once-then-fail behaviour, and that
// capabilities/client/prompt loading follow the deferred-init contract.

import { describe, expect, it } from 'vitest';
import { LlmAgentBackend } from '@/backend/llm/backend';
import type { ModelClient, ModelResponse } from '@/backend/llm/types';
import type { BackendCapabilities, SanitizedObservation } from '@/backend/types';
import { createLogger } from '@/logging';
import { createFakeSink } from '../../logging/fakeSink';

const CAPS: BackendCapabilities = { maxImagesPerRequest: 1, maxImageBytes: 1, maxContextTokens: 1000 };

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

function clientReturning(...texts: string[]): ModelClient {
  const queue = [...texts];
  return {
    id: 'fake',
    capabilities: { ...CAPS, supportsJsonMode: true },
    async generate(): Promise<ModelResponse> {
      const text = queue.shift();
      if (text === undefined) throw new Error('no more canned responses');
      return { text };
    },
  };
}

const VALID = '{"thought":"ok","done":true,"actions":[]}';

describe('LlmAgentBackend', () => {
  it('exposes capabilities synchronously, before init()', () => {
    const backend = new LlmAgentBackend({
      id: 'llm:test',
      capabilities: CAPS,
      logger: createLogger(createFakeSink()),
      loadSystemPrompt: async () => 'sys',
      loadClient: async () => clientReturning(VALID),
    });
    expect(backend.capabilities).toBe(CAPS);
    expect(backend.id).toBe('llm:test');
  });

  it('returns the parsed response on a valid first reply', async () => {
    const backend = new LlmAgentBackend({
      id: 'llm:test',
      capabilities: CAPS,
      logger: createLogger(createFakeSink()),
      loadSystemPrompt: async () => 'sys',
      loadClient: async () => clientReturning(VALID),
    });
    await backend.init();
    const result = await backend.decide(obs());
    expect(result).toEqual({ thought: 'ok', done: true, actions: [] });
  });

  it('retries once with an error note after an invalid first reply, then succeeds', async () => {
    const client = clientReturning('not json at all', VALID);
    const backend = new LlmAgentBackend({
      id: 'llm:test',
      capabilities: CAPS,
      logger: createLogger(createFakeSink()),
      loadSystemPrompt: async () => 'sys',
      loadClient: async () => client,
    });
    await backend.init();
    const result = await backend.decide(obs());
    expect(result).toEqual({ thought: 'ok', done: true, actions: [] });
  });

  it('throws backend_invalid_response after two invalid replies', async () => {
    const backend = new LlmAgentBackend({
      id: 'llm:test',
      capabilities: CAPS,
      logger: createLogger(createFakeSink()),
      loadSystemPrompt: async () => 'sys',
      loadClient: async () => clientReturning('nope', 'still nope'),
    });
    await backend.init();
    await expect(backend.decide(obs())).rejects.toMatchObject({ reason: 'backend_invalid_response' });
  });

  it('logs action.validate with a fail outcome when both attempts are invalid', async () => {
    const sink = createFakeSink();
    const logger = createLogger(sink);
    const backend = new LlmAgentBackend({
      id: 'llm:test',
      capabilities: CAPS,
      logger,
      loadSystemPrompt: async () => 'sys',
      loadClient: async () => clientReturning('nope', 'still nope'),
    });
    await backend.init();
    await backend.decide(obs()).catch(() => {});
    await logger.flush();
    expect(sink.records).toContainEqual(
      expect.objectContaining({ op: 'action.validate', outcome: 'fail', reason: 'backend_invalid_response' }),
    );
  });

  it('rejects decide() called before init()', async () => {
    const backend = new LlmAgentBackend({
      id: 'llm:test',
      capabilities: CAPS,
      logger: createLogger(createFakeSink()),
      loadSystemPrompt: async () => 'sys',
      loadClient: async () => clientReturning(VALID),
    });
    await expect(backend.decide(obs())).rejects.toMatchObject({ reason: 'backend_error' });
  });

  it('only builds the client and loads the prompt once across repeated init() calls', async () => {
    let clientBuilds = 0;
    let promptLoads = 0;
    const backend = new LlmAgentBackend({
      id: 'llm:test',
      capabilities: CAPS,
      logger: createLogger(createFakeSink()),
      loadSystemPrompt: async () => {
        promptLoads++;
        return 'sys';
      },
      loadClient: async () => {
        clientBuilds++;
        return clientReturning(VALID, VALID);
      },
    });
    await backend.init();
    await backend.init();
    expect(clientBuilds).toBe(1);
    expect(promptLoads).toBe(1);
  });
});
