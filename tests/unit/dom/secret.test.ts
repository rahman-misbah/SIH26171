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

  it('flags a name like cvv even without autocomplete', () => {
    expect(isSecretField(input({ type: 'text', name: 'cvv' }))).toBe(true);
  });

  it('flags autocomplete=current-password / new-password / cc-number / cc-csc / cc-exp*', () => {
    expect(isSecretField(input({ type: 'text', autocomplete: 'current-password' }))).toBe(true);
    expect(isSecretField(input({ type: 'text', autocomplete: 'new-password' }))).toBe(true);
    expect(isSecretField(input({ type: 'text', autocomplete: 'cc-number' }))).toBe(true);
    expect(isSecretField(input({ type: 'text', autocomplete: 'cc-csc' }))).toBe(true);
    expect(isSecretField(input({ type: 'text', autocomplete: 'cc-exp-month' }))).toBe(true);
  });

  // M12: the name/id rule matches word parts, not substrings. On httpbin's
  // form every `name="topping"` checkbox was flagged (top-PIN-g), and the
  // same substring hit `pincode`, India's postal-code field.
  it('flags otp/cvv/cvc/pin as a word part of name or id, in any naming style', () => {
    for (const name of ['pin', 'PIN', 'userPin', 'user_pin', 'pin-number', 'pinNo', 'otp_code', 'txtOTP', 'otpInput', 'cvv2', 'card-cvc', 'CVV']) {
      expect(isSecretField(input({ type: 'text', name })), name).toBe(true);
    }
    expect(isSecretField(input({ type: 'text', id: 'loginOtp' }))).toBe(true);
  });

  it('does not flag names that only contain those letters inside another word', () => {
    for (const name of ['topping', 'shipping', 'shipping_address', 'mapping', 'spinner', 'opinion', 'hotpot', 'pincode', 'pinCode', 'pin_code', 'delivery-pincode']) {
      expect(isSecretField(input({ type: 'text', name })), name).toBe(false);
    }
  });

  it('does not flag an ordinary text input', () => {
    expect(isSecretField(input({ type: 'text', name: 'upi' }))).toBe(false);
  });

  it('does not flag a non-input element', () => {
    const el = document.createElement('div');
    expect(isSecretField(el)).toBe(false);
  });
});
