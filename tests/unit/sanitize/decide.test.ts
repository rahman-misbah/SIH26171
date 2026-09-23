// §7.4 decision rule: regex spans kept as-is, NER spans merged in (already
// label-mapped to PiiType by the provider, §7.2/§9.3), EMAIL spans dropped
// only when the public-email heuristic (§7.5) scores them public.

import { describe, expect, it } from 'vitest';
import { decidePii } from '@/sanitize/decide';
import type { ContextHints } from '@/dom/types';

const noHints: ContextHints = { in_landmark: false, near_contact_heading: false, in_contact_markup: false, in_ugc_block: false };
const ctx = { pageOrigin: 'https://example.com', hints: noHints, isMailtoHref: false };

describe('decidePii', () => {
  it('keeps regex spans as-is', () => {
    const spans = decidePii('a@b.example', [{ type: 'PHONE', start: 0, end: 5 }], [], ctx);
    expect(spans).toEqual([{ type: 'PHONE', start: 0, end: 5 }]);
  });

  it('adds a non-overlapping NER span using its already-mapped PiiType label', () => {
    const spans = decidePii('0123456789Priya Sharma', [], [{ start: 10, end: 22, label: 'NAME', confidence: 'high' }], ctx);
    expect(spans).toEqual([{ type: 'NAME', start: 10, end: 22 }]);
  });

  it('falls back to OTHER for an unrecognized label (fail-closed, still PII)', () => {
    const spans = decidePii('xxxxORGANIZATION', [], [{ start: 4, end: 16, label: 'ORGANIZATION_RAW', confidence: 'high' }], ctx);
    expect(spans).toEqual([{ type: 'OTHER', start: 4, end: 16 }]);
  });

  it('any confidence bucket counts as PII (fail-closed, §7.3)', () => {
    const spans = decidePii('Priya', [], [{ start: 0, end: 5, label: 'NAME', confidence: 'low' }], ctx);
    expect(spans).toHaveLength(1);
  });

  it('drops a NER span that overlaps an already-claimed regex span', () => {
    const spans = decidePii(
      '0123456789',
      [{ type: 'PHONE', start: 0, end: 10 }],
      [{ start: 5, end: 15, label: 'MISC', confidence: 'high' }],
      ctx,
    );
    expect(spans).toEqual([{ type: 'PHONE', start: 0, end: 10 }]);
  });

  it('sorts merged spans by start position', () => {
    const spans = decidePii(
      '01234567890123456789 Priya',
      [{ type: 'PHONE', start: 20, end: 25 }],
      [{ start: 0, end: 5, label: 'NAME', confidence: 'high' }],
      ctx,
    );
    expect(spans.map((s) => s.start)).toEqual([0, 20]);
  });

  it('keeps a private email (below the public-email threshold) as a redacted span', () => {
    const text = 'priya.sharma@gmail.com';
    const spans = decidePii(text, [{ type: 'EMAIL', start: 0, end: text.length }], [], ctx);
    expect(spans).toEqual([{ type: 'EMAIL', start: 0, end: text.length }]);
  });

  it('drops a public email (heuristic score >= 4) instead of redacting it', () => {
    const text = 'support@example.com';
    const publicCtx = {
      pageOrigin: 'https://example.com',
      hints: { in_landmark: false, near_contact_heading: false, in_contact_markup: true, in_ugc_block: false },
      isMailtoHref: false,
    };
    const spans = decidePii(text, [{ type: 'EMAIL', start: 0, end: text.length }], [], publicCtx);
    expect(spans).toEqual([]);
  });

  it('only applies the email heuristic to EMAIL-typed spans, not other regex types', () => {
    const text = 'support@example.com';
    const publicCtx = {
      pageOrigin: 'https://example.com',
      hints: { in_landmark: false, near_contact_heading: false, in_contact_markup: true, in_ugc_block: false },
      isMailtoHref: false,
    };
    // Same string, but claimed as a different type -- must never be dropped
    // by the email heuristic just because it looks email-shaped.
    const spans = decidePii(text, [{ type: 'UPI', start: 0, end: text.length }], [], publicCtx);
    expect(spans).toEqual([{ type: 'UPI', start: 0, end: text.length }]);
  });
});
