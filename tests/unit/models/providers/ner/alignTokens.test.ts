import { describe, expect, it } from 'vitest';
import { alignTokensToText, groupAlignedTokens, type RawNerToken } from '@/models/providers/ner/alignTokens';

// Captured verbatim from a real inference run of gravitee-io/bert-small-pii-detection
// (via `classifier([text], { ignore_labels: [] })`) against this exact string,
// while validating the provider design -- see M7 Log for how this was found.
const TEXT = 'Contact Priya Sharma at priya@example.com or call +91 98765 43210, thanks Acme Corp.';
const REAL_TOKENS: RawNerToken[] = [
  { entity: 'O', score: 0.969, word: 'contact' },
  { entity: 'B-PERSON', score: 0.7148, word: 'pri' },
  { entity: 'I-PERSON', score: 0.8944, word: '##ya' },
  { entity: 'B-PERSON', score: 0.7268, word: 'sharma' },
  { entity: 'O', score: 0.993, word: 'at' },
  { entity: 'B-EMAIL_ADDRESS', score: 0.9654, word: 'pri' },
  { entity: 'I-EMAIL_ADDRESS', score: 0.9861, word: '##ya' },
  { entity: 'I-EMAIL_ADDRESS', score: 0.9825, word: '@' },
  { entity: 'I-EMAIL_ADDRESS', score: 0.9868, word: 'example' },
  { entity: 'I-EMAIL_ADDRESS', score: 0.9863, word: '.' },
  { entity: 'I-EMAIL_ADDRESS', score: 0.9841, word: 'com' },
  { entity: 'O', score: 0.991, word: 'or' },
  { entity: 'O', score: 0.984, word: 'call' },
  { entity: 'B-PHONE_NUMBER', score: 0.9708, word: '+' },
  { entity: 'I-PHONE_NUMBER', score: 0.9539, word: '91' },
  { entity: 'I-PHONE_NUMBER', score: 0.9547, word: '98' },
  { entity: 'I-PHONE_NUMBER', score: 0.9612, word: '##7' },
  { entity: 'I-PHONE_NUMBER', score: 0.963, word: '##65' },
  { entity: 'I-PHONE_NUMBER', score: 0.9616, word: '43' },
  { entity: 'I-PHONE_NUMBER', score: 0.9636, word: '##21' },
  { entity: 'I-PHONE_NUMBER', score: 0.9634, word: '##0' },
  { entity: 'O', score: 0.994, word: ',' },
  { entity: 'O', score: 0.991, word: 'thanks' },
  { entity: 'B-ORGANIZATION', score: 0.8913, word: 'ac' },
  { entity: 'I-ORGANIZATION', score: 0.829, word: '##me' },
  { entity: 'I-ORGANIZATION', score: 0.8109, word: 'corp' },
  { entity: 'I-ORGANIZATION', score: 0.7008, word: '.' },
];

describe('alignTokensToText + groupAlignedTokens (real captured token stream)', () => {
  const aligned = alignTokensToText(TEXT, REAL_TOKENS);
  const grouped = groupAlignedTokens(aligned);

  it('aligns every token (no unicode/casing surprises in this fixture)', () => {
    expect(aligned).toHaveLength(REAL_TOKENS.length);
  });

  it('recovers exact substrings for each aligned token', () => {
    for (const token of aligned) {
      // No claim about *which* text it should be -- just that start/end
      // are valid, non-empty, in-order slices of the real string.
      expect(token.end).toBeGreaterThan(token.start);
      expect(TEXT.slice(token.start, token.end).length).toBe(token.end - token.start);
    }
  });

  it('groups "Priya" and "Sharma" as two separate PERSON spans (B- immediately after B-, matching the library\'s own aggregation semantics)', () => {
    const personGroups = grouped.filter((g) => g.label === 'PERSON');
    expect(personGroups).toHaveLength(2);
    expect(TEXT.slice(personGroups[0]!.start, personGroups[0]!.end)).toBe('Priya');
    expect(TEXT.slice(personGroups[1]!.start, personGroups[1]!.end)).toBe('Sharma');
  });

  it('groups the email into one contiguous EMAIL_ADDRESS span covering the exact address', () => {
    const email = grouped.find((g) => g.label === 'EMAIL_ADDRESS')!;
    expect(TEXT.slice(email.start, email.end)).toBe('priya@example.com');
  });

  it('groups the phone number into one contiguous PHONE_NUMBER span', () => {
    const phone = grouped.find((g) => g.label === 'PHONE_NUMBER')!;
    expect(TEXT.slice(phone.start, phone.end)).toBe('+91 98765 43210');
  });

  it('groups the organization into one contiguous ORGANIZATION span including the trailing period', () => {
    const org = grouped.find((g) => g.label === 'ORGANIZATION')!;
    expect(TEXT.slice(org.start, org.end)).toBe('Acme Corp.');
  });

  it('averages the group score over its constituent tokens', () => {
    const email = grouped.find((g) => g.label === 'EMAIL_ADDRESS')!;
    const expected = (0.9654 + 0.9861 + 0.9825 + 0.9868 + 0.9863 + 0.9841) / 6;
    expect(email.score).toBeCloseTo(expected, 4);
  });
});

describe('alignTokensToText', () => {
  it('drops a token it cannot find, without corrupting the cursor for later tokens', () => {
    const tokens: RawNerToken[] = [
      { entity: 'O', score: 0.9, word: 'hello' },
      { entity: 'B-PERSON', score: 0.9, word: 'zzz-unmatchable-zzz' },
      { entity: 'O', score: 0.9, word: 'world' },
    ];
    const aligned = alignTokensToText('hello world', tokens);
    expect(aligned).toHaveLength(2);
    expect(aligned.map((t) => t.entity)).toEqual(['O', 'O']);
    expect('hello world'.slice(aligned[1]!.start, aligned[1]!.end)).toBe('world');
  });

  it('requires a continuation token to attach with zero gap', () => {
    const tokens: RawNerToken[] = [
      { entity: 'B-PERSON', score: 0.9, word: 'pri' },
      { entity: 'I-PERSON', score: 0.9, word: '##ya' },
    ];
    const aligned = alignTokensToText('priya', tokens);
    expect(aligned).toEqual([
      { entity: 'B-PERSON', score: 0.9, start: 0, end: 3 },
      { entity: 'I-PERSON', score: 0.9, start: 3, end: 5 },
    ]);
  });
});

describe('groupAlignedTokens', () => {
  it('returns no groups for an all-O token stream', () => {
    expect(groupAlignedTokens([{ entity: 'O', score: 0.9, start: 0, end: 5 }])).toEqual([]);
  });

  it('merges I- tokens into the preceding B- of the same tag', () => {
    const groups = groupAlignedTokens([
      { entity: 'B-LOCATION', score: 0.8, start: 0, end: 3 },
      { entity: 'I-LOCATION', score: 0.6, start: 3, end: 6 },
    ]);
    expect(groups).toEqual([{ label: 'LOCATION', start: 0, end: 6, score: 0.7 }]);
  });

  it('starts a new group when the tag changes even mid I- run', () => {
    const groups = groupAlignedTokens([
      { entity: 'B-LOCATION', score: 0.8, start: 0, end: 3 },
      { entity: 'I-PERSON', score: 0.8, start: 3, end: 6 },
    ]);
    expect(groups.map((g) => g.label)).toEqual(['LOCATION', 'PERSON']);
  });
});
