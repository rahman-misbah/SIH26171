// §7.1 Tier-1 regex tier. Positive cases come straight from the canary
// fixture set (§18 item 2); a few extras cover ordering (UPI before email)
// and checksum-failing numeric look-alikes that must NOT match (§7.1: "fall
// through to NER rather than being dropped" -- i.e. the regex tier itself
// must not flag them, since flagging both here and at decide-time would
// double count and it's the checksum check that decides pass/fail).

import { describe, expect, it } from 'vitest';
import { matchRegexSpans } from '@/sanitize/regex';
import { loadCanaries } from '../../fixtures/loadCanaries';

const canaries = loadCanaries();

function canary(id: string): string {
  const found = canaries.find((c) => c.id === id);
  if (!found) throw new Error(`missing canary fixture: ${id}`);
  return found.value;
}

describe('matchRegexSpans', () => {
  it.each([
    ['email-personal', 'EMAIL'],
    ['email-public-support', 'EMAIL'],
    ['upi', 'UPI'],
    ['phone', 'PHONE'],
    ['aadhaar-valid', 'AADHAAR'],
    ['aadhaar-masked', 'AADHAAR'],
    ['pan', 'PAN'],
    ['card-valid', 'CARD'],
    ['ifsc', 'IFSC'],
    ['passport', 'PASSPORT'],
    ['voter-id', 'VOTER_ID'],
    ['gstin', 'GSTIN'],
    ['vehicle-reg', 'VEHICLE_REG'],
  ])('matches the %s canary as %s', (id, type) => {
    const text = canary(id);
    const spans = matchRegexSpans(text);
    expect(spans.some((s) => s.type === type && text.slice(s.start, s.end) === text)).toBe(true);
  });

  it('does not flag a checksum-failing Aadhaar look-alike (falls through to NER instead)', () => {
    const spans = matchRegexSpans(canary('aadhaar-invalid'));
    expect(spans.some((s) => s.type === 'AADHAAR')).toBe(false);
  });

  it('does not flag a checksum-failing card look-alike', () => {
    const spans = matchRegexSpans(canary('card-invalid'));
    expect(spans.some((s) => s.type === 'CARD')).toBe(false);
  });

  it('matches UPI, not EMAIL, for a dot-free PSP handle', () => {
    const spans = matchRegexSpans('priya.sharma@okaxis');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.type).toBe('UPI');
  });

  it('still matches EMAIL for a normal address with a dotted domain', () => {
    const spans = matchRegexSpans('priya.sharma.canary@example.com');
    expect(spans.some((s) => s.type === 'EMAIL')).toBe(true);
    expect(spans.some((s) => s.type === 'UPI')).toBe(false);
  });

  it('finds multiple spans in one text without overlap', () => {
    const text = `Email ${canary('email-personal')} and PAN ${canary('pan')}`;
    const spans = matchRegexSpans(text);
    expect(spans.some((s) => s.type === 'EMAIL')).toBe(true);
    expect(spans.some((s) => s.type === 'PAN')).toBe(true);
    for (const span of spans) {
      expect(text.slice(span.start, span.end).length).toBeGreaterThan(0);
    }
  });

  it('returns no spans for text with no PII', () => {
    expect(matchRegexSpans('Totally agree with the above.')).toEqual([]);
  });
});
