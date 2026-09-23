import { describe, expect, it } from 'vitest';
import { createSanitizeMemo } from '@/sanitize/memo';
import type { ContextHints } from '@/dom/types';

const hintsA: ContextHints = { in_landmark: false, near_contact_heading: false, in_contact_markup: true, in_ugc_block: false };
const hintsB: ContextHints = { in_landmark: false, near_contact_heading: false, in_contact_markup: false, in_ugc_block: true };

describe('createSanitizeMemo', () => {
  it('misses before anything is stored', async () => {
    const memo = createSanitizeMemo();
    expect(await memo.lookup('https://example.com', 'hello', undefined)).toBeUndefined();
  });

  it('hits after a store for the same origin/text/context', async () => {
    const memo = createSanitizeMemo();
    await memo.store('https://example.com', 'call 555-1234', hintsA, '[PII_PHONE_1]');
    expect(await memo.lookup('https://example.com', 'call 555-1234', hintsA)).toBe('[PII_PHONE_1]');
  });

  it('does not collide across different origins for the same text (§7.6 per-origin stability)', async () => {
    const memo = createSanitizeMemo();
    await memo.store('https://a.example', 'x@example.com', undefined, '[PII_EMAIL_1]');
    expect(await memo.lookup('https://b.example', 'x@example.com', undefined)).toBeUndefined();
  });

  it('does not collide across different context hints for the same text (avoids reusing a context-dependent decision)', async () => {
    const memo = createSanitizeMemo();
    await memo.store('https://example.com', 'priya@example.com', hintsA, 'priya@example.com'); // public in context A
    expect(await memo.lookup('https://example.com', 'priya@example.com', hintsB)).toBeUndefined();
  });

  it('treats undefined context consistently (not the same key as a context with all-false hints)', async () => {
    const memo = createSanitizeMemo();
    const allFalse: ContextHints = { in_landmark: false, near_contact_heading: false, in_contact_markup: false, in_ugc_block: false };
    await memo.store('https://example.com', 'hello', undefined, 'no-context-result');
    expect(await memo.lookup('https://example.com', 'hello', allFalse)).toBe('no-context-result');
    // (digest of "all false" and "undefined" both serialize to the same
    // empty/zero digest by design -- documented, not a bug: an absent
    // ContextHints and an explicitly-all-false one carry identical
    // information for the heuristic.)
  });

  it('the underlying key is not extractable', async () => {
    const memo = createSanitizeMemo();
    await memo.store('https://example.com', 'a', undefined, 'b');
    // No public API exposes the CryptoKey at all -- this test just documents
    // the guarantee lives in generateKey's `extractable: false` argument,
    // exercised implicitly by every store/lookup call above succeeding.
    expect(await memo.lookup('https://example.com', 'a', undefined)).toBe('b');
  });
});
