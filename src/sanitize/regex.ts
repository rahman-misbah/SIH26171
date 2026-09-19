// §7.1: Tier-1 deterministic regex matchers. Boundaries use `\b`-style
// alnum lookaround instead of `\b` itself so hyphens/spaces inside a
// candidate (Aadhaar/card groups, phone separators) don't break the match.
// DOB is deliberately not implemented here (M5 Log: deferred to M7's NER,
// see docs/MILESTONES.md M5 entry) -- proximity-to-a-"DOB"-label detection
// is closer to the heuristic work than a pure regex.

import { isValidLuhn } from './luhn';
import { isValidVerhoeff } from './verhoeff';
import type { PiiType } from './types';

export interface RegexSpan {
  type: PiiType;
  start: number;
  end: number;
}

interface Matcher {
  type: PiiType;
  pattern: RegExp;
  // Raw matched substring (separators intact) -> accept/reject. Absent = always accept.
  validate?: (raw: string) => boolean;
}

const ALNUM_BOUND_BEFORE = '(?<![A-Za-z0-9])';
const ALNUM_BOUND_AFTER = '(?![A-Za-z0-9])';

// UPI first (§7.1): the PSP-handle class is letters-only with no dot, so it
// naturally can't match a real email domain (which requires a dot) -- but
// checked first anyway per the spec's explicit ordering note.
const UPI_RE = /(?<![\w.+-])[\w.+-]+@[a-zA-Z]{2,64}(?![\w.-])/g;
const EMAIL_RE = /(?<![\w.+-])[\w.+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+(?![\w.-])/g;

const AADHAAR_MASKED_RE = /(?<![A-Za-z0-9])[Xx]{4}[\s-]?[Xx]{4}[\s-]?\d{4}(?!\d)/g;
const AADHAAR_RE = /(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g;

const CARD_RE = /(?<!\d)(?:\d[\s-]?){13,19}(?<=\d)(?!\d)/g;

// 4th character = holder-type code (§7.1).
const PAN_HOLDER_TYPES = new Set(['A', 'B', 'C', 'F', 'G', 'H', 'J', 'L', 'P', 'T']);
const PAN_RE = new RegExp(`${ALNUM_BOUND_BEFORE}[A-Z]{5}[0-9]{4}[A-Z]${ALNUM_BOUND_AFTER}`, 'g');

const IFSC_RE = new RegExp(`${ALNUM_BOUND_BEFORE}[A-Z]{4}0[A-Z0-9]{6}${ALNUM_BOUND_AFTER}`, 'g');
const GSTIN_RE = new RegExp(
  `${ALNUM_BOUND_BEFORE}\\d{2}[A-Z]{5}\\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]${ALNUM_BOUND_AFTER}`,
  'g',
);
const VOTER_ID_RE = new RegExp(`${ALNUM_BOUND_BEFORE}[A-Z]{3}\\d{7}${ALNUM_BOUND_AFTER}`, 'g');
const PASSPORT_RE = new RegExp(`${ALNUM_BOUND_BEFORE}[A-PR-WY][1-9]\\d{6}${ALNUM_BOUND_AFTER}`, 'g');
const VEHICLE_REG_RE = new RegExp(
  `${ALNUM_BOUND_BEFORE}[A-Z]{2}\\d{2}[A-Z]{1,2}\\d{4}${ALNUM_BOUND_AFTER}`,
  'g',
);

const PHONE_INDIA_RE = /(?<!\d)(?:\+91[-\s]?|0)?[6-9]\d{4}[-\s]?\d{5}(?!\d)/g;
const PHONE_E164_RE = /(?<!\d)\+[1-9]\d{7,14}(?!\d)/g;

const matchers: Matcher[] = [
  { type: 'UPI', pattern: UPI_RE },
  { type: 'EMAIL', pattern: EMAIL_RE },
  { type: 'AADHAAR', pattern: AADHAAR_MASKED_RE },
  {
    type: 'AADHAAR',
    pattern: AADHAAR_RE,
    validate: (raw) => {
      const digits = raw.replace(/[\s-]/g, '');
      return digits.length === 12 && digits[0] !== '0' && digits[0] !== '1' && isValidVerhoeff(digits);
    },
  },
  { type: 'CARD', pattern: CARD_RE, validate: (raw) => isValidLuhn(raw.replace(/[\s-]/g, '')) },
  { type: 'PAN', pattern: PAN_RE, validate: (raw) => PAN_HOLDER_TYPES.has(raw[3] ?? '') },
  { type: 'IFSC', pattern: IFSC_RE },
  { type: 'GSTIN', pattern: GSTIN_RE },
  { type: 'VOTER_ID', pattern: VOTER_ID_RE },
  { type: 'PASSPORT', pattern: PASSPORT_RE },
  { type: 'VEHICLE_REG', pattern: VEHICLE_REG_RE },
  { type: 'PHONE', pattern: PHONE_INDIA_RE },
  { type: 'PHONE', pattern: PHONE_E164_RE },
];

function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

export function matchRegexSpans(text: string): RegexSpan[] {
  const spans: RegexSpan[] = [];
  const claimed: [number, number][] = [];

  for (const matcher of matchers) {
    matcher.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = matcher.pattern.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (claimed.some((range) => overlaps(range, [start, end]))) continue;
      if (matcher.validate && !matcher.validate(match[0])) continue;
      spans.push({ type: matcher.type, start, end });
      claimed.push([start, end]);
    }
  }

  return spans.sort((a, b) => a.start - b.start);
}
