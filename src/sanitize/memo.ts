// §7.7: sanitization memo. Re-observing a mostly-unchanged page across agent
// steps shouldn't re-run regex + NER on identical content. Keyed by
// HMAC(sessionKey, ...), sessionKey generated via crypto.subtle per session
// and never persisted/extractable -- a memo hit can't be reversed to raw text
// without that in-memory key (§2.7 unaffected).
//
// Two refinements on the spec's literal `Map<HMAC(sessionKey, text), ...>`,
// both folded into the HMAC input rather than a second lookup structure:
//  - `origin` is included so identical text on two different origins can't
//    collide and return one origin's tokenized output for the other's
//    (§7.6 requires tokens stable *per session and origin*, not just per text).
//  - a stable digest of the ContextHints is included so the same text under
//    different structural context (e.g. the same email string once inside a
//    contact block and once inside a UGC comment) is memoized separately --
//    otherwise the public-email heuristic's context-dependent decision for
//    the first occurrence would be silently reused for the second, which can
//    under-redact (a real leak risk, not just a cosmetic one).

import type { ContextHints } from '@/dom/types';

export interface SanitizeMemo {
  lookup(origin: string, text: string, context: ContextHints | undefined): Promise<string | undefined>;
  store(origin: string, text: string, context: ContextHints | undefined, result: string): Promise<void>;
}

// Absent hints and explicitly-all-false hints carry the same information for
// the email heuristic (no positive signal either way), so they deliberately
// digest to the same key.
function contextDigest(context: ContextHints | undefined): string {
  const c = context ?? { in_landmark: false, near_contact_heading: false, in_contact_markup: false, in_ugc_block: false };
  return `${c.in_landmark ? 1 : 0}${c.near_contact_heading ? 1 : 0}${c.in_contact_markup ? 1 : 0}${c.in_ugc_block ? 1 : 0}`;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function createSanitizeMemo(): SanitizeMemo {
  const cache = new Map<string, string>();
  let keyPromise: Promise<CryptoKey> | undefined;

  function getKey(): Promise<CryptoKey> {
    keyPromise ??= crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return keyPromise;
  }

  async function digest(origin: string, text: string, context: ContextHints | undefined): Promise<string> {
    const key = await getKey();
    const input = `${origin}\u0000${contextDigest(context)}\u0000${text}`;
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
    return toHex(sig);
  }

  return {
    async lookup(origin, text, context) {
      return cache.get(await digest(origin, text, context));
    },
    async store(origin, text, context, result) {
      cache.set(await digest(origin, text, context), result);
    },
  };
}
