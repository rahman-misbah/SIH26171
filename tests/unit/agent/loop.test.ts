// §13.2: the host-side per-step loop. Session state (token map, abort
// controller, history) lives inside createAgentLoop()'s own Map, mirroring
// how src/logging/logger.ts's createLogger(sink) owns its ring buffer --
// each test gets a fresh, isolated loop instance.

import { describe, expect, it, vi } from 'vitest';
import { createAgentLoop, MAX_STEPS, type DecideStepInput } from '@/agent/loop';
import type { AgentResponse } from '@/agent/schema';
import type { AgentBackend, BackendCapabilities, SanitizedObservation } from '@/backend/types';
import { createLogger, ReasonCodeError } from '@/logging';
import type { SkeletonNode } from '@/dom/types';
import { createFakeSink } from '../logging/fakeSink';

const CAPS: BackendCapabilities = { maxImagesPerRequest: 1, maxImageBytes: 1, maxContextTokens: 1000 };

function fakeBackend(responses: AgentResponse[]): AgentBackend & { signals: (AbortSignal | undefined)[] } {
  const queue = [...responses];
  const signals: (AbortSignal | undefined)[] = [];
  return {
    id: 'fake',
    capabilities: CAPS,
    signals,
    async init() {},
    async decide(_obs: SanitizedObservation, signal?: AbortSignal): Promise<AgentResponse> {
      signals.push(signal);
      const next = queue.shift();
      if (!next) throw new Error('fakeBackend: no more canned responses');
      return next;
    },
  };
}

const secretNode: SkeletonNode = {
  node_id: 'secret1',
  tag: 'input',
  node_type: 'element',
  parent_id: null,
  bbox: { x: 0, y: 0, w: 10, h: 10 },
  visible: true,
  in_viewport: true,
  secret: true,
  pending_content: [],
};

const clickTarget: SkeletonNode = {
  node_id: 'btn1',
  tag: 'button',
  node_type: 'element',
  parent_id: null,
  bbox: { x: 0, y: 0, w: 10, h: 10 },
  visible: true,
  in_viewport: true,
  pending_content: [],
};

function baseInput(overrides: Partial<DecideStepInput> = {}): DecideStepInput {
  return {
    session_id: 's1',
    step: 1,
    task: 'do the thing',
    page: { url: 'https://example.com/', title: 'Example', viewport: { w: 100, h: 100 }, scroll: { x: 0, y: 0 } },
    skeleton: [secretNode, clickTarget],
    contentResults: [],
    origin: 'https://example.com',
    ...overrides,
  };
}

function makeLogger() {
  const sink = createFakeSink();
  return { logger: createLogger(sink), sink };
}

describe('createAgentLoop.decideStep', () => {
  it('stops resolving at the first policy-blocked action, returning only the resolved prefix', async () => {
    const loop = createAgentLoop();
    const { logger } = makeLogger();
    const backend = fakeBackend([
      {
        thought: 'clicking then typing into a secret field',
        done: false,
        actions: [
          { type: 'click', node_id: 'btn1' },
          { type: 'type', node_id: 'secret1', text: 'hello' }, // policy_target: secret field
          { type: 'click', node_id: 'btn1' },
        ],
      },
    ]);

    const result = await loop.decideStep(baseInput(), backend, logger);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.resolvedActions).toEqual([{ type: 'click', node_id: 'btn1' }]);
  });

  it('logs a token.resolve record for both the passing and the blocked action', async () => {
    const loop = createAgentLoop();
    const { logger, sink } = makeLogger();
    const backend = fakeBackend([
      {
        thought: 'x',
        done: false,
        actions: [
          { type: 'click', node_id: 'btn1' },
          { type: 'type', node_id: 'secret1', text: 'hello' },
        ],
      },
    ]);

    await loop.decideStep(baseInput(), backend, logger);
    await logger.flush();
    const tokenRecords = sink.records.filter((r) => r.op === 'token.resolve');
    expect(tokenRecords).toHaveLength(2);
    expect(tokenRecords[0]?.outcome).toBe('ok');
    expect(tokenRecords[1]).toMatchObject({ outcome: 'blocked', reason: 'policy_target' });
  });

  it('carries recorded history into the next step observation', async () => {
    const loop = createAgentLoop();
    const { logger } = makeLogger();
    const decideSpy = vi.fn<AgentBackend['decide']>(async () => ({
      thought: 'ok',
      done: false,
      actions: [],
    }));
    const backend: AgentBackend = { id: 'spy', capabilities: CAPS, async init() {}, decide: decideSpy };

    await loop.decideStep(baseInput({ step: 1 }), backend, logger);
    loop.recordStepResults('s1', []);
    await loop.decideStep(baseInput({ step: 2 }), backend, logger);

    expect(decideSpy).toHaveBeenCalledTimes(2);
    const secondObs = decideSpy.mock.calls[1]?.[0] as SanitizedObservation;
    expect(secondObs.history).toEqual([{ step: 1, thought: 'ok', actions: [], results: [] }]);
  });

  it('pads results with blocked then not_run after a policy-blocked action', async () => {
    const loop = createAgentLoop();
    const { logger } = makeLogger();
    const decideSpy = vi.fn<AgentBackend['decide']>(async () => ({
      thought: 'noop',
      done: true,
      actions: [],
    }));
    const backend: AgentBackend = { id: 'spy', capabilities: CAPS, async init() {}, decide: decideSpy };

    const first = fakeBackend([
      {
        thought: 'first',
        done: false,
        actions: [
          { type: 'click', node_id: 'btn1' },
          { type: 'type', node_id: 'secret1', text: 'hello' },
          { type: 'click', node_id: 'btn1' },
        ],
      },
    ]);
    await loop.decideStep(baseInput({ step: 1 }), first, logger);
    loop.recordStepResults('s1', ['ok']);
    await loop.decideStep(baseInput({ step: 2 }), backend, logger);

    const secondObs = decideSpy.mock.calls[0]?.[0] as SanitizedObservation;
    expect(secondObs.history).toEqual([
      {
        step: 1,
        thought: 'first',
        actions: [
          { type: 'click', node_id: 'btn1' },
          { type: 'type', node_id: 'secret1', text: 'hello' },
          { type: 'click', node_id: 'btn1' },
        ],
        results: ['ok', 'blocked', 'not_run'],
      },
    ]);
  });

  it('returns blocked when the §14.5 final guard trips', async () => {
    const loop = createAgentLoop();
    const { logger } = makeLogger();
    const backend = fakeBackend([{ thought: 'x', done: true, actions: [] }]);
    const result = await loop.decideStep(
      baseInput({
        skeleton: [
          {
            node_id: 'n1',
            tag: '#text',
            node_type: 'text',
            parent_id: null,
            bbox: { x: 0, y: 0, w: 10, h: 10 },
            visible: true,
            in_viewport: true,
            pending_content: ['text'],
          },
        ],
        contentResults: [{ node_id: 'n1', field: 'text', text: 'contact priya.sharma.canary@example.com' }],
      }),
      backend,
      logger,
    );
    expect(result).toEqual({ status: 'blocked' });
  });

  it('maps a thrown ReasonCodeError to a fail result', async () => {
    const loop = createAgentLoop();
    const { logger } = makeLogger();
    const backend: AgentBackend = {
      id: 'failing',
      capabilities: CAPS,
      async init() {},
      async decide() {
        throw new ReasonCodeError('backend_invalid_response');
      },
    };
    const result = await loop.decideStep(baseInput(), backend, logger);
    expect(result).toEqual({ status: 'fail', reason: 'backend_invalid_response' });
  });

  it('aborts the in-flight signal and clears session state on stopSession', async () => {
    const loop = createAgentLoop();
    const { logger } = makeLogger();
    const backend = fakeBackend([{ thought: 'x', done: false, actions: [] }]);

    await loop.decideStep(baseInput(), backend, logger);
    const signal = backend.signals[0];
    expect(signal?.aborted).toBe(false);

    loop.stopSession('s1');
    expect(signal?.aborted).toBe(true);
  });
});

describe('MAX_STEPS', () => {
  it('matches the §13.2 default', () => {
    expect(MAX_STEPS).toBe(10);
  });
});
