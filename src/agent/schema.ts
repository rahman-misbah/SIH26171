// §13.1: the response schema every backend (LLM or custom server) must return,
// plus the hand-written validator shared by every backend kind. Token semantics
// (§13.4, e.g. "tokens forbidden in navigate.url") are a separate policy check
// that runs after validation, once the token map is available — not enforced here.

export type Action =
  | { type: 'click'; node_id: string }
  | { type: 'type'; node_id: string; text: string; submit?: boolean }
  | { type: 'select'; node_id: string; value: string }
  | { type: 'scroll'; direction: 'up' | 'down' }
  | { type: 'scroll_to'; node_id: string }
  | { type: 'navigate'; url: string }
  | { type: 'wait'; ms: number };

export interface AgentResponse {
  thought: string; // <= MAX_THOUGHT_LENGTH chars, shown in overlay, kept in history
  actions: Action[]; // <= MAX_ACTIONS_PER_STEP
  done: boolean;
  answer?: string; // tokens in it are resolved only for on-screen display, never sent anywhere
}

export type ActionResult = 'ok' | 'stale_node' | 'not_interactable' | 'blocked' | 'not_run';

export const MAX_ACTIONS_PER_STEP = 3;
export const MAX_THOUGHT_LENGTH = 200;
export const MAX_WAIT_MS = 3000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAction(value: unknown): value is Action {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'click':
      return typeof value.node_id === 'string';
    case 'type':
      return (
        typeof value.node_id === 'string' &&
        typeof value.text === 'string' &&
        (value.submit === undefined || typeof value.submit === 'boolean')
      );
    case 'select':
      return typeof value.node_id === 'string' && typeof value.value === 'string';
    case 'scroll':
      return value.direction === 'up' || value.direction === 'down';
    case 'scroll_to':
      return typeof value.node_id === 'string';
    case 'navigate':
      return typeof value.url === 'string';
    case 'wait':
      return typeof value.ms === 'number' && value.ms <= MAX_WAIT_MS;
    default:
      return false;
  }
}

export function isAgentResponse(value: unknown): value is AgentResponse {
  if (!isRecord(value)) return false;
  if (typeof value.thought !== 'string' || value.thought.length > MAX_THOUGHT_LENGTH) return false;
  if (typeof value.done !== 'boolean') return false;
  if (value.answer !== undefined && typeof value.answer !== 'string') return false;
  if (!Array.isArray(value.actions) || value.actions.length > MAX_ACTIONS_PER_STEP) return false;
  return value.actions.every(isAction);
}
