// §7.6: token format, per-(origin, type, normalized value) stability, and
// entry shape. The map itself lives only in compute-host memory (never
// persisted/logged) -- this tests the class in isolation.

import { describe, expect, it } from 'vitest';
import { TokenMapImpl } from '@/sanitize/tokenMap';

describe('TokenMapImpl', () => {
  it('formats tokens as [PII_<TYPE>_<n>]', () => {
    const map = new TokenMapImpl();
    const token = map.tokenize({
      type: 'EMAIL',
      value: 'a@example.com',
      origin: 'https://example.com',
      source: { node_id: 'n1', field: 'text', offset: 0 },
    });
    expect(token).toBe('[PII_EMAIL_1]');
  });

  it('is stable for the same (origin, type, normalized value)', () => {
    const map = new TokenMapImpl();
    const first = map.tokenize({
      type: 'EMAIL',
      value: 'a@example.com',
      origin: 'https://example.com',
      source: { node_id: 'n1', field: 'text', offset: 0 },
    });
    const second = map.tokenize({
      type: 'EMAIL',
      value: 'a@example.com',
      origin: 'https://example.com',
      source: { node_id: 'n2', field: 'text', offset: 0 },
    });
    expect(second).toBe(first);
  });

  it('normalizes case/whitespace before comparing values', () => {
    const map = new TokenMapImpl();
    const first = map.tokenize({
      type: 'EMAIL',
      value: 'A@Example.com',
      origin: 'https://example.com',
      source: { node_id: 'n1', field: 'text', offset: 0 },
    });
    const second = map.tokenize({
      type: 'EMAIL',
      value: ' a@example.com ',
      origin: 'https://example.com',
      source: { node_id: 'n2', field: 'text', offset: 0 },
    });
    expect(second).toBe(first);
  });

  it('assigns a new token per distinct value, counting per type', () => {
    const map = new TokenMapImpl();
    const first = map.tokenize({
      type: 'EMAIL',
      value: 'a@example.com',
      origin: 'https://example.com',
      source: { node_id: 'n1', field: 'text', offset: 0 },
    });
    const secondValue = map.tokenize({
      type: 'EMAIL',
      value: 'b@example.com',
      origin: 'https://example.com',
      source: { node_id: 'n2', field: 'text', offset: 0 },
    });
    expect(first).toBe('[PII_EMAIL_1]');
    expect(secondValue).toBe('[PII_EMAIL_2]');
  });

  it('keeps per-type counters independent', () => {
    const map = new TokenMapImpl();
    map.tokenize({
      type: 'EMAIL',
      value: 'a@example.com',
      origin: 'https://example.com',
      source: { node_id: 'n1', field: 'text', offset: 0 },
    });
    const phoneToken = map.tokenize({
      type: 'PHONE',
      value: '+919876543210',
      origin: 'https://example.com',
      source: { node_id: 'n2', field: 'text', offset: 0 },
    });
    expect(phoneToken).toBe('[PII_PHONE_1]');
  });

  it('scopes the same value by origin', () => {
    const map = new TokenMapImpl();
    const onExampleCom = map.tokenize({
      type: 'EMAIL',
      value: 'a@example.com',
      origin: 'https://example.com',
      source: { node_id: 'n1', field: 'text', offset: 0 },
    });
    const onOtherCom = map.tokenize({
      type: 'EMAIL',
      value: 'a@example.com',
      origin: 'https://other.com',
      source: { node_id: 'n1', field: 'text', offset: 0 },
    });
    expect(onOtherCom).not.toBe(onExampleCom);
  });

  it('records every source against the entry, and never exposes the raw value in resolve() misuse (entry shape only)', () => {
    const map = new TokenMapImpl();
    const token = map.tokenize({
      type: 'EMAIL',
      value: 'a@example.com',
      origin: 'https://example.com',
      source: { node_id: 'n1', field: 'text', offset: 0 },
    });
    map.tokenize({
      type: 'EMAIL',
      value: 'a@example.com',
      origin: 'https://example.com',
      source: { node_id: 'n2', field: 'placeholder', offset: 3 },
    });
    const entry = map.entryForToken(token);
    expect(entry?.token).toBe(token);
    expect(entry?.type).toBe('EMAIL');
    expect(entry?.value).toBe('a@example.com');
    expect(entry?.sources).toHaveLength(2);
    expect(typeof entry?.created_at).toBe('number');
  });

  it('resolves a token back to its raw value', () => {
    const map = new TokenMapImpl();
    const token = map.tokenize({
      type: 'EMAIL',
      value: 'a@example.com',
      origin: 'https://example.com',
      source: { node_id: 'n1', field: 'text', offset: 0 },
    });
    expect(map.resolve(token)).toBe('a@example.com');
  });

  it('returns undefined resolving an unknown token', () => {
    const map = new TokenMapImpl();
    expect(map.resolve('[PII_EMAIL_99]')).toBeUndefined();
  });
});

describe('TokenMapImpl.knownValues (M12)', () => {
  it('lists the values tokenized on one origin, never another', () => {
    const map = new TokenMapImpl();
    const source = { node_id: 'n1', field: 'text', offset: 0 };
    map.tokenize({ type: 'NAME', value: 'Priya Sharma', origin: 'https://a.example', source });
    map.tokenize({ type: 'PHONE', value: '+91 98765 43210', origin: 'https://a.example', source });
    map.tokenize({ type: 'NAME', value: 'Arjun Rao', origin: 'https://b.example', source });
    expect(map.knownValues('https://a.example')).toEqual([
      { type: 'NAME', value: 'Priya Sharma' },
      { type: 'PHONE', value: '+91 98765 43210' },
    ]);
    expect(map.knownValues('https://c.example')).toEqual([]);
  });
});
