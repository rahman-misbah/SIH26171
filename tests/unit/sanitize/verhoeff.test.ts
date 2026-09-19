// §7.1 Aadhaar checksum. Table of d/p/inv straight from the Verhoeff algorithm
// spec; tested against the canary fixture's valid/invalid Aadhaar pair.

import { describe, expect, it } from 'vitest';
import { isValidVerhoeff } from '@/sanitize/verhoeff';
import { loadCanaries } from '../../fixtures/loadCanaries';

describe('isValidVerhoeff', () => {
  it('accepts a known-valid Verhoeff checksum (canary fixture)', () => {
    const canary = loadCanaries().find((c) => c.id === 'aadhaar-valid');
    expect(canary).toBeDefined();
    expect(isValidVerhoeff(canary!.value.replace(/\s/g, ''))).toBe(true);
  });

  it('rejects a Verhoeff checksum with the last digit changed (canary fixture)', () => {
    const canary = loadCanaries().find((c) => c.id === 'aadhaar-invalid');
    expect(canary).toBeDefined();
    expect(isValidVerhoeff(canary!.value.replace(/\s/g, ''))).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(isValidVerhoeff('12345678901a')).toBe(false);
  });

  it('rejects the wrong length', () => {
    expect(isValidVerhoeff('123456789')).toBe(false);
  });
});
