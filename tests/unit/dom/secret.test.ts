// @vitest-environment happy-dom
// §5.1: secret fields are never read. Exercised against secret-form.html's
// three cases (password, one-time-code, name-pattern CVV) plus a negative case.

import { describe, expect, it } from 'vitest';
import { isSecretField } from '@/dom/secret';

function input(attrs: Record<string, string>): HTMLInputElement {
  const el = document.createElement('input');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

describe('isSecretField', () => {
  it('flags a password input', () => {
    expect(isSecretField(input({ type: 'password', name: 'password' }))).toBe(true);
  });

  it('flags autocomplete=one-time-code', () => {
    expect(isSecretField(input({ type: 'text', id: 'otp', autocomplete: 'one-time-code' }))).toBe(true);
  });

  it('flags a name matching /otp|cvv|cvc|pin/i even without autocomplete', () => {
    expect(isSecretField(input({ type: 'text', name: 'cvv' }))).toBe(true);
  });

  it('flags autocomplete=current-password / new-password / cc-number / cc-csc / cc-exp*', () => {
    expect(isSecretField(input({ type: 'text', autocomplete: 'current-password' }))).toBe(true);
    expect(isSecretField(input({ type: 'text', autocomplete: 'new-password' }))).toBe(true);
    expect(isSecretField(input({ type: 'text', autocomplete: 'cc-number' }))).toBe(true);
    expect(isSecretField(input({ type: 'text', autocomplete: 'cc-csc' }))).toBe(true);
    expect(isSecretField(input({ type: 'text', autocomplete: 'cc-exp-month' }))).toBe(true);
  });

  it('does not flag an ordinary text input', () => {
    expect(isSecretField(input({ type: 'text', name: 'upi' }))).toBe(false);
  });

  it('does not flag a non-input element', () => {
    const el = document.createElement('div');
    expect(isSecretField(el)).toBe(false);
  });
});
