// §13.2 "resolved = resolve_tokens(action)": runs only after checkPolicy
// (§13.4) has already confirmed every token in the action is known and
// same-origin, so this is a plain substitution -- never a source of a block.

import type { Action } from './schema';
import type { TokenMapImpl } from '@/sanitize/tokenMap';

const TOKEN_PATTERN = /\[PII_[A-Z_]+_\d+\]/g;

function substitute(text: string, tokenMap: TokenMapImpl): string {
  return text.replace(TOKEN_PATTERN, (token) => tokenMap.resolve(token) ?? token);
}

export function resolveActionTokens(action: Action, tokenMap: TokenMapImpl): Action {
  if (action.type === 'type') return { ...action, text: substitute(action.text, tokenMap) };
  if (action.type === 'select') return { ...action, value: substitute(action.value, tokenMap) };
  return action;
}
