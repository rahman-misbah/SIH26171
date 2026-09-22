// §13.4: token egress policy. Pass + fail case per rule, written first per
// CLAUDE.md/MILESTONES M6. Rule 1 ("tokens resolve only in type.text /
// select.value") has no independent fail case of its own -- it's exercised
// by construction (click/scroll/scroll_to/wait carry no free-text field a
// token could hide in) and by rule 2's fail case (a token in navigate.url).

import { describe, expect, it } from 'vitest';
import { checkPolicy, type PolicyContext } from '@/agent/policy';
import { TokenMapImpl } from '@/sanitize/tokenMap';
import type { SanitizedNode } from '@/dom/types';

const ORIGIN = 'https://example.com';

function node(overrides: Partial<SanitizedNode> = {}): SanitizedNode {
  return {
    node_id: 'n1',
    tag: 'input',
    node_type: 'element',
    parent_id: null,
    bbox: { x: 0, y: 0, w: 10, h: 10 },
    visible: true,
    in_viewport: true,
    content: {},
    ...overrides,
  };
}

function makeCtx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  const nodes = new Map<string, SanitizedNode>([['n1', node()]]);
  return {
    tokenMap: new TokenMapImpl(),
    pageOrigin: ORIGIN,
    findNode: (id) => nodes.get(id),
    ...overrides,
  };
}

function tokenizedCtx(): { ctx: PolicyContext; token: string } {
  const tokenMap = new TokenMapImpl();
  const token = tokenMap.tokenize({
    type: 'EMAIL',
    value: 'a@example.com',
    origin: ORIGIN,
    source: { node_id: 'n1', field: 'value', offset: 0 },
  });
  return { ctx: makeCtx({ tokenMap }), token };
}

describe('checkPolicy', () => {
  // Rule 1
  it('never blocks non-text-carrying actions (click/scroll/scroll_to/wait)', () => {
    const ctx = makeCtx();
    expect(checkPolicy({ type: 'click', node_id: 'n1' }, ctx)).toEqual({ ok: true });
    expect(checkPolicy({ type: 'scroll', direction: 'down' }, ctx)).toEqual({ ok: true });
    expect(checkPolicy({ type: 'scroll_to', node_id: 'n1' }, ctx)).toEqual({ ok: true });
    expect(checkPolicy({ type: 'wait', ms: 500 }, ctx)).toEqual({ ok: true });
  });

  // Rule 2
  it('blocks a navigate.url containing a token', () => {
    const { ctx, token } = tokenizedCtx();
    const result = checkPolicy({ type: 'navigate', url: `https://example.com/${token}` }, ctx);
    expect(result).toEqual({ ok: false, reason: 'policy_url_token' });
  });

  it('blocks a non-http(s) navigate.url', () => {
    const ctx = makeCtx();
    const result = checkPolicy({ type: 'navigate', url: 'javascript:alert(1)' }, ctx);
    expect(result).toEqual({ ok: false, reason: 'policy_url_token' });
  });

  it('allows a token-free http(s) navigate.url', () => {
    const ctx = makeCtx();
    expect(checkPolicy({ type: 'navigate', url: 'https://example.com/next' }, ctx)).toEqual({ ok: true });
  });

  // Rule 3
  it('blocks a token whose origin differs from the current page', () => {
    const tokenMap = new TokenMapImpl();
    const token = tokenMap.tokenize({
      type: 'EMAIL',
      value: 'a@example.com',
      origin: 'https://other.com',
      source: { node_id: 'n1', field: 'value', offset: 0 },
    });
    const ctx = makeCtx({ tokenMap });
    const result = checkPolicy({ type: 'type', node_id: 'n1', text: token }, ctx);
    expect(result).toEqual({ ok: false, reason: 'policy_cross_origin' });
  });

  it('allows a token whose origin matches the current page', () => {
    const { ctx, token } = tokenizedCtx();
    expect(checkPolicy({ type: 'type', node_id: 'n1', text: token }, ctx)).toEqual({ ok: true });
  });

  // Rule 4
  it('blocks typing into a field whose form posts cross-origin', () => {
    const { ctx, token } = tokenizedCtx();
    const crossOriginCtx = makeCtx({
      tokenMap: ctx.tokenMap,
      findNode: () => node({ form_action_origin: 'https://evil.example' }),
    });
    const result = checkPolicy({ type: 'type', node_id: 'n1', text: token }, crossOriginCtx);
    expect(result).toEqual({ ok: false, reason: 'policy_form_origin' });
  });

  it('allows typing into a field whose form posts same-origin (or has no form)', () => {
    const { ctx, token } = tokenizedCtx();
    expect(checkPolicy({ type: 'type', node_id: 'n1', text: token }, ctx)).toEqual({ ok: true });
  });

  // Rule 5
  it('blocks typing into a secret field', () => {
    const { ctx, token } = tokenizedCtx();
    const secretCtx = makeCtx({ tokenMap: ctx.tokenMap, findNode: () => node({ secret: true }) });
    expect(checkPolicy({ type: 'type', node_id: 'n1', text: token }, secretCtx)).toEqual({
      ok: false,
      reason: 'policy_target',
    });
  });

  it('blocks typing into a non-editable node', () => {
    const { ctx, token } = tokenizedCtx();
    const divCtx = makeCtx({ tokenMap: ctx.tokenMap, findNode: () => node({ tag: 'div', role: undefined }) });
    expect(checkPolicy({ type: 'type', node_id: 'n1', text: token }, divCtx)).toEqual({
      ok: false,
      reason: 'policy_target',
    });
  });

  it('blocks an action targeting an unknown node_id', () => {
    const { ctx, token } = tokenizedCtx();
    const missingCtx = makeCtx({ tokenMap: ctx.tokenMap, findNode: () => undefined });
    expect(checkPolicy({ type: 'type', node_id: 'ghost', text: token }, missingCtx)).toEqual({
      ok: false,
      reason: 'policy_target',
    });
  });

  it('allows typing into an editable, non-secret input', () => {
    const { ctx, token } = tokenizedCtx();
    expect(checkPolicy({ type: 'type', node_id: 'n1', text: token }, ctx)).toEqual({ ok: true });
  });

  // Rule 6
  it('blocks an unknown token', () => {
    const ctx = makeCtx();
    const result = checkPolicy({ type: 'select', node_id: 'n1', value: '[PII_EMAIL_99]' }, ctx);
    expect(result).toEqual({ ok: false, reason: 'policy_unknown_token' });
  });

  it('allows plain text with no tokens at all', () => {
    const ctx = makeCtx();
    expect(checkPolicy({ type: 'type', node_id: 'n1', text: 'hello' }, ctx)).toEqual({ ok: true });
  });
});
