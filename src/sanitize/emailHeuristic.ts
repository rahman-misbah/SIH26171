// §7.5: public-vs-private email heuristic. Weighted, rule-based, no model --
// weights are copied verbatim from the spec table and must stay explainable
// to judges (CLAUDE.md).

import type { ContextHints } from '@/dom/types';

// +3: role-account local parts (§7.5).
const ROLE_LOCAL_PARTS = new Set([
  'support',
  'info',
  'contact',
  'sales',
  'help',
  'noreply',
  'no-reply',
  'admin',
  'care',
  'hr',
  'careers',
]);

// -4: free-mail providers (§7.5) -- a role-shaped local part at one of these
// (e.g. support@gmail.com) still nets positive only if other signals apply;
// the negative weight alone doesn't force private, it's additive like the rest.
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'proton.me',
  'protonmail.com',
  'icloud.com',
  'rediffmail.com',
]);

const PUBLIC_THRESHOLD = 4;

function normalizeDomain(domain: string): string {
  return domain.toLowerCase().replace(/\.$/, '');
}

// "Equals or is a subdomain of" (§7.5) -- no public-suffix-list dependency;
// approximated as exact match or a dot-bounded suffix match against the
// page's own hostname. Documented approximation, not a full eTLD+1 parse.
function isSameOrSubdomain(emailDomain: string, pageHost: string): boolean {
  const a = normalizeDomain(emailDomain);
  const b = normalizeDomain(pageHost);
  return a === b || a.endsWith(`.${b}`);
}

export interface EmailHeuristicInput {
  email: string;
  pageOrigin: string; // e.g. "https://example.com" -- hostname read from this
  hints: ContextHints | undefined;
  // True when this specific email occurrence is the target of a `mailto:`
  // href (as opposed to plain visible text) -- §7.5's "mailto: in a landmark"
  // sub-condition needs to know this in addition to in_landmark.
  isMailtoHref: boolean;
}

export function scorePublicEmail(input: EmailHeuristicInput): number {
  const { email, pageOrigin, hints, isMailtoHref } = input;
  const atIndex = email.lastIndexOf('@');
  if (atIndex === -1) return 0; // not email-shaped; caller shouldn't reach here
  const localPart = email.slice(0, atIndex).toLowerCase();
  const domain = email.slice(atIndex + 1);

  let score = 0;

  if (ROLE_LOCAL_PARTS.has(localPart)) score += 3;

  let pageHost = '';
  try {
    pageHost = new URL(pageOrigin).hostname;
  } catch {
    // pageOrigin isn't a valid URL -- no domain signal, pageHost stays ''.
  }
  if (pageHost !== '' && isSameOrSubdomain(domain, pageHost)) score += 3;

  if (FREE_MAIL_DOMAINS.has(normalizeDomain(domain))) score -= 4;

  const contactSignal =
    (hints?.in_contact_markup ?? false) || (hints?.near_contact_heading ?? false) || ((hints?.in_landmark ?? false) && isMailtoHref);
  if (contactSignal) score += 2;

  if (hints?.in_ugc_block) score -= 3;

  return score;
}

export function isPublicEmail(input: EmailHeuristicInput): boolean {
  return scorePublicEmail(input) >= PUBLIC_THRESHOLD;
}
