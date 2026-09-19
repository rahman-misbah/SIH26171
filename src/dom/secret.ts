// §5.1: secret fields are never read. `value` must never be accessed when
// this returns true -- callers substitute "[SECRET]" instead.

const SECRET_AUTOCOMPLETE_VALUES = new Set([
  'one-time-code',
  'current-password',
  'new-password',
  'cc-number',
  'cc-csc',
]);

const SECRET_NAME_RE = /otp|cvv|cvc|pin/i;

export function isSecretField(el: Element): boolean {
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.type === 'password') return true;

  const autocomplete = el.getAttribute('autocomplete') ?? '';
  if (SECRET_AUTOCOMPLETE_VALUES.has(autocomplete) || autocomplete.startsWith('cc-exp')) return true;

  const name = el.getAttribute('name') ?? '';
  const id = el.getAttribute('id') ?? '';
  return SECRET_NAME_RE.test(name) || SECRET_NAME_RE.test(id);
}
