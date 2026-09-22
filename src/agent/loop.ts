// §13.2: the host-side half of the agent loop. Owns per-session state (token
// map, abort controller, history) -- the content-script side (src/dom/
// agentSession.ts) owns the actual `for step in 1..MAX_STEPS` iteration,
// DOM reads and action execution, calling decideStep()/recordStepResults()
// once per step through the compute host's dispatch table
// (src/core/computeHost.ts), because only the content script can read the
// DOM or execute an action -- "runs in the compute host" (SPEC §13.2) means
// the session/policy/token-map state does, not that one process does
// everything the pseudocode's `for` loop lists.
//
// Per-step split with content: policy_check stops resolving at the first
// blocked action (rule 7's "end batch"), so decideStep returns only the
// resolved prefix; content executes that prefix in order and stops locally
// at the first non-ok result, then reports back what it actually ran via
// recordStepResults, which pads the rest of this step's *original* action
// list as 'blocked' (the one policy stopped on) or 'not_run' (everything
// after it, or after content's own early stop) to build one full History
// entry -- the shape SanitizedObservation.history expects.

import { assembleObservation } from './assemble';
import { checkPolicy, type PolicyContext } from './policy';
import { resolveActionTokens } from './resolveTokens';
import type { Action, ActionResult, AgentResponse } from './schema';
import type { AgentBackend, SanitizedObservation } from '@/backend/types';
import type { ContentField, SkeletonNode } from '@/dom/types';
import { ReasonCodeError } from '@/logging';
import type { ReasonCode, RuntimeLogger } from '@/logging';
import { TokenMapImpl } from '@/sanitize/tokenMap';

// §13.2 default.
export const MAX_STEPS = 10;

export interface DecideStepInput {
  session_id: string;
  step: number;
  task: string; // already sanitized
  page: { url: string; title: string; viewport: { w: number; h: number }; scroll: { x: number; y: number } };
  skeleton: SkeletonNode[];
  contentResults: { node_id: string; field: ContentField; text: string }[];
  origin: string; // current page origin, for §13.4 rules 2-4
}

export type DecideStepResult =
  | { status: 'blocked' } // §14.5 final guard tripped -- treated as fail-closed, session should stop
  | { status: 'fail'; reason: ReasonCode }
  | {
      status: 'ok';
      done: boolean;
      thought: string;
      answer?: string;
      // Tokens already substituted with real values; the resolved *prefix*
      // up to (not including) the first policy-blocked action.
      resolvedActions: Action[];
    };

export interface AgentLoop {
  decideStep(input: DecideStepInput, backend: AgentBackend, logger: RuntimeLogger): Promise<DecideStepResult>;
  // `results` are what content actually ran, in order, for the resolved
  // prefix decideStep last returned for this session -- may be shorter than
  // that prefix if content stopped early on a non-ok result.
  recordStepResults(session_id: string, results: ActionResult[]): void;
  stopSession(session_id: string): void;
  // §7.6: also used by the sanitizeChunk dispatch case (Phase B tokenizes
  // PII before an agent-loop step ever runs) -- the agent loop is the single
  // owner of per-session token maps, not just of decideStep's callers.
  getOrCreateTokenMap(session_id: string): TokenMapImpl;
}

interface PendingStep {
  step: number;
  thought: string;
  actions: Action[]; // original, unresolved (what the backend returned)
  blockedAtIndex: number | undefined;
}

interface AgentSession {
  tokenMap: TokenMapImpl;
  abortController: AbortController;
  history: SanitizedObservation['history'];
  pending: PendingStep | undefined;
}

function toReasonCode(error: unknown): ReasonCode {
  return error instanceof ReasonCodeError ? error.reason : 'backend_error';
}

export function createAgentLoop(): AgentLoop {
  const sessions = new Map<string, AgentSession>();

  function getOrCreateSession(session_id: string): AgentSession {
    let session = sessions.get(session_id);
    if (!session) {
      session = { tokenMap: new TokenMapImpl(), abortController: new AbortController(), history: [], pending: undefined };
      sessions.set(session_id, session);
    }
    return session;
  }

  async function decideStep(input: DecideStepInput, backend: AgentBackend, logger: RuntimeLogger): Promise<DecideStepResult> {
    const session = getOrCreateSession(input.session_id);

    return logger.timed('agent.step', { session_id: input.session_id, step: input.step }, async () => {
      const assembled = assembleObservation({
        session_id: input.session_id,
        step: input.step,
        task: input.task,
        page: input.page,
        skeleton: input.skeleton,
        contentResults: input.contentResults,
        history: session.history,
      });
      if (assembled.status !== 'ok') return { status: 'blocked' };

      let response: AgentResponse;
      try {
        response = await logger.timed('backend.decide', { session_id: input.session_id, step: input.step }, () =>
          backend.decide(assembled.observation, session.abortController.signal),
        );
      } catch (error) {
        return { status: 'fail', reason: toReasonCode(error) };
      }

      const nodesById = new Map(assembled.observation.dom.map((node) => [node.node_id, node]));
      const policyCtx: PolicyContext = {
        tokenMap: session.tokenMap,
        pageOrigin: input.origin,
        findNode: (id) => nodesById.get(id),
      };

      const resolvedActions: Action[] = [];
      let blockedAtIndex: number | undefined;
      for (let i = 0; i < response.actions.length; i++) {
        const action = response.actions[i]!;
        const check = checkPolicy(action, policyCtx);
        // Rule 7: every resolution and every block is logged.
        const now = performance.timeOrigin + performance.now();
        logger.record({
          session_id: input.session_id,
          step: input.step,
          op: 'token.resolve',
          t_start: now,
          t_end: now,
          duration_ms: 0,
          outcome: check.ok ? 'ok' : 'blocked',
          reason: check.ok ? undefined : check.reason,
          ref: 'node_id' in action ? action.node_id : undefined,
        });
        if (!check.ok) {
          blockedAtIndex = i;
          break; // rule "blocked -> end batch": nothing after this is even resolved
        }
        resolvedActions.push(resolveActionTokens(action, session.tokenMap));
      }

      session.pending = { step: input.step, thought: response.thought, actions: response.actions, blockedAtIndex };

      return { status: 'ok', done: response.done, thought: response.thought, answer: response.answer, resolvedActions };
    });
  }

  function recordStepResults(session_id: string, results: ActionResult[]): void {
    const session = sessions.get(session_id);
    const pending = session?.pending;
    if (!session || !pending) return;

    const executedCount = pending.blockedAtIndex ?? pending.actions.length;
    const merged: ActionResult[] = pending.actions.map((_action, i) => {
      if (i < executedCount) return results[i] ?? 'not_run'; // content stopped early
      if (i === pending.blockedAtIndex) return 'blocked';
      return 'not_run'; // never resolved -- the block ended the batch before reaching it
    });

    session.history.push({ step: pending.step, thought: pending.thought, actions: pending.actions, results: merged });
    session.pending = undefined;
  }

  function stopSession(session_id: string): void {
    const session = sessions.get(session_id);
    session?.abortController.abort();
    sessions.delete(session_id); // clears the token map -- §7.6
  }

  return {
    decideStep,
    recordStepResults,
    stopSession,
    getOrCreateTokenMap: (session_id: string) => getOrCreateSession(session_id).tokenMap,
  };
}
