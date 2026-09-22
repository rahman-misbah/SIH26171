// §13.4: token egress policy, checked before token resolution and before
// handing any action to the content script for execution. Pure and
// platform-free so it's unit-testable in isolation; the loop (§13.2) wires
// this to the per-session TokenMap/observation and logs every pass/block
// (rule 7 -- logging itself is an integration concern, covered where the
// loop calls this, not here).

import type { Action } from './schema';
import type { SanitizedNode } from '@/dom/types';
import type { ReasonCode } from '@/logging/schema';
import type { TokenMapImpl } from '@/sanitize/tokenMap';

export interface PolicyContext {
  tokenMap: TokenMapImpl;
  pageOrigin: string;
  // Looks up an action's target by node_id in this step's already-assembled
  // SanitizedObservation. Undefined (unresolvable/hallucinated node_id) is
  // treated fail-closed, same as a resolved-but-wrong-kind target.
  findNode: (node_id: string) => SanitizedNode | undefined;
}

export type PolicyResult = { ok: true } | { ok: false; reason: ReasonCode };

// Matches the exact token shape TokenMapImpl mints (`[PII_<TYPE>_<n>]`).
const TOKEN_PATTERN = /\[PII_[A-Z_]+_\d+\]/g;

function tokensIn(text: string): string[] {
  return text.match(TOKEN_PATTERN) ?? [];
}

// Rule 5 scope: only `type`'s target must be editable/non-secret (the spec
// text names `type` specifically; `select`'s target is a <select> by
// construction).
function isEditableField(node: SanitizedNode): boolean {
  return node.tag === 'input' || node.tag === 'textarea' || node.role === 'textbox';
}

// Rule 3 + rule 6, shared by `type` and `select`: every token referenced in
// the action's text must be known and same-origin.
function checkTokens(text: string, ctx: PolicyContext): PolicyResult {
  for (const token of tokensIn(text)) {
    const entry = ctx.tokenMap.entryForToken(token);
    if (!entry) return { ok: false, reason: 'policy_unknown_token' };
    if (entry.origin !== ctx.pageOrigin) return { ok: false, reason: 'policy_cross_origin' };
  }
  return { ok: true };
}

// Rule 4, shared by `type` and `select`.
function checkFormOrigin(node: SanitizedNode, ctx: PolicyContext): PolicyResult {
  if (node.form_action_origin && node.form_action_origin !== ctx.pageOrigin) {
    return { ok: false, reason: 'policy_form_origin' };
  }
  return { ok: true };
}

export function checkPolicy(action: Action, ctx: PolicyContext): PolicyResult {
  switch (action.type) {
    // Rule 1: click/scroll/scroll_to/wait carry no free-text field a token
    // could hide in -- nothing to check.
    case 'click':
    case 'scroll':
    case 'scroll_to':
    case 'wait':
      return { ok: true };

    // Rule 2.
    case 'navigate': {
      if (tokensIn(action.url).length > 0) return { ok: false, reason: 'policy_url_token' };
      let scheme: string;
      try {
        scheme = new URL(action.url, ctx.pageOrigin).protocol;
      } catch {
        return { ok: false, reason: 'policy_url_token' };
      }
      if (scheme !== 'http:' && scheme !== 'https:') return { ok: false, reason: 'policy_url_token' };
      return { ok: true };
    }

    case 'type': {
      const node = ctx.findNode(action.node_id);
      if (!node || !isEditableField(node) || node.secret) return { ok: false, reason: 'policy_target' };
      const formCheck = checkFormOrigin(node, ctx);
      if (!formCheck.ok) return formCheck;
      return checkTokens(action.text, ctx);
    }

    case 'select': {
      const node = ctx.findNode(action.node_id);
      if (!node) return { ok: false, reason: 'policy_target' };
      const formCheck = checkFormOrigin(node, ctx);
      if (!formCheck.ok) return formCheck;
      return checkTokens(action.value, ctx);
    }
  }
}
