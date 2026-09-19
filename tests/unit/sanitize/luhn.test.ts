// §7.1 card-number checksum, tested against the canary fixture's valid/invalid pair.

import { describe, expect, it } from 'vitest';
import { isValidLuhn } from '@/sanitize/luhn';
import { loadCanaries } from '../../fixtures/loadCanaries';

describe('isValidLuhn', () => {
  it('accepts a known-valid Luhn checksum (canary fixture)', () => {
    const canary = loadCanaries().find((c) => c.id === 'card-valid');
    expect(canary).toBeDefined();
    expect(isValidLuhn(canary!.value.replace(/\s/g, ''))).toBe(true);
  });

  it('rejects a Luhn checksum with the last digit changed (canary fixture)', () => {
    const canary = loadCanaries().find((c) => c.id === 'card-invalid');
    expect(canary).toBeDefined();
    expect(isValidLuhn(canary!.value.replace(/\s/g, ''))).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(isValidLuhn('4111111111111x11')).toBe(false);
  });
});
