// Token substitution runs only after checkPolicy has already verified every
// referenced token is known and same-origin (§13.4) -- resolveTokens itself
// stays a plain, always-succeeding substitution.

import { describe, expect, it } from 'vitest';
import { resolveActionTokens } from '@/agent/resolveTokens';
import { TokenMapImpl } from '@/sanitize/tokenMap';

function tokenMapWithEmail(): { tokenMap: TokenMapImpl; token: string } {
  const tokenMap = new TokenMapImpl();
  const token = tokenMap.tokenize({
    type: 'EMAIL',
    value: 'real@example.com',
    origin: 'https://example.com',
    source: { node_id: 'n1', field: 'value', offset: 0 },
  });
  return { tokenMap, token };
}

describe('resolveActionTokens', () => {
  it('substitutes a token in type.text with its real value', () => {
    const { tokenMap, token } = tokenMapWithEmail();
    const resolved = resolveActionTokens({ type: 'type', node_id: 'n1', text: `Contact: ${token}` }, tokenMap);
    expect(resolved).toEqual({ type: 'type', node_id: 'n1', text: 'Contact: real@example.com' });
  });

  it('substitutes a token in select.value', () => {
    const { tokenMap, token } = tokenMapWithEmail();
    const resolved = resolveActionTokens({ type: 'select', node_id: 'n1', value: token }, tokenMap);
    expect(resolved).toEqual({ type: 'select', node_id: 'n1', value: 'real@example.com' });
  });

  it('substitutes multiple distinct tokens in one string', () => {
    const tokenMap = new TokenMapImpl();
    const email = tokenMap.tokenize({
      type: 'EMAIL',
      value: 'a@example.com',
      origin: 'https://example.com',
      source: { node_id: 'n1', field: 'value', offset: 0 },
    });
    const phone = tokenMap.tokenize({
      type: 'PHONE',
      value: '+919876543210',
      origin: 'https://example.com',
      source: { node_id: 'n1', field: 'value', offset: 0 },
    });
    const resolved = resolveActionTokens({ type: 'type', node_id: 'n1', text: `${email} / ${phone}` }, tokenMap);
    expect(resolved).toEqual({ type: 'type', node_id: 'n1', text: 'a@example.com / +919876543210' });
  });

  it('leaves an action with no tokens unchanged', () => {
    const { tokenMap } = tokenMapWithEmail();
    const resolved = resolveActionTokens({ type: 'type', node_id: 'n1', text: 'hello' }, tokenMap);
    expect(resolved).toEqual({ type: 'type', node_id: 'n1', text: 'hello' });
  });

  it('passes through other action types unchanged', () => {
    const { tokenMap } = tokenMapWithEmail();
    expect(resolveActionTokens({ type: 'click', node_id: 'n1' }, tokenMap)).toEqual({ type: 'click', node_id: 'n1' });
    expect(resolveActionTokens({ type: 'scroll', direction: 'up' }, tokenMap)).toEqual({
      type: 'scroll',
      direction: 'up',
    });
  });

  it('preserves submit on a type action', () => {
    const { tokenMap, token } = tokenMapWithEmail();
    const resolved = resolveActionTokens({ type: 'type', node_id: 'n1', text: token, submit: true }, tokenMap);
    expect(resolved).toEqual({ type: 'type', node_id: 'n1', text: 'real@example.com', submit: true });
  });
});
