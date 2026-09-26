// §5.1: secret fields are never read. `value` must never be accessed when
// this returns true -- callers substitute "[SECRET]" instead.

const SECRET_AUTOCOMPLETE_VALUES = new Set([
  'one-time-code',
  'current-password',
  'new-password',
  'cc-number',
  'cc-csc',
]);

// Matched against word parts of `name`/`id`, not as a substring (M12): a
// substring match flagged `topping` (top-PIN-g), `shipping`, and `pincode`,
// India's postal-code field -- which the agent then couldn't fill. A trailing
// number is allowed (`cvv2`).
const SECRET_PART_RE = /^(otp|cvv|cvc|pin)\d*$/;

// `userPin` / `user_pin` / `txtOTP` / `OTPInput` -> lowercase word parts.
function wordParts(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part !== '')
    .map((part) => part.toLowerCase());
}

function hasSecretPart(value: string): boolean {
  const parts = wordParts(value);
  // `pin_code` / `pinCode` is a postal code, not a PIN.
  return parts.some((part, i) => SECRET_PART_RE.test(part) && !(part === 'pin' && parts[i + 1] === 'code'));
}

export function isSecretField(el: Element): boolean {
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.type === 'password') return true;

  const autocomplete = el.getAttribute('autocomplete') ?? '';
  if (SECRET_AUTOCOMPLETE_VALUES.has(autocomplete) || autocomplete.startsWith('cc-exp')) return true;

  const name = el.getAttribute('name') ?? '';
  const id = el.getAttribute('id') ?? '';
  return hasSecretPart(name) || hasSecretPart(id);
}
