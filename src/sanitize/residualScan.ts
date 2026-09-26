// M12 (§18.1 on real sites): re-runs the regex tier over every string of an
// outgoing SanitizedObservation. Real sites have no canaries, so this is the
// leak check there: the pipeline tokenizes every regex hit except emails the
// §7.5 heuristic keeps public (decide.ts), so any other hit here is a leak
// candidate to investigate. Returns counts only -- never matched values.

import { scorePublicEmail } from './emailHeuristic';
import { matchRegexSpans } from './regex';
import type { PiiType } from './types';

export type ResidualKind = PiiType | 'EMAIL_LIKELY_PUBLIC';

export interface ResidualScanResult {
  scanned_strings: number;
  hits: Partial<Record<ResidualKind, number>>;
}

// Image bytes (base64 once serialized) are pixels, not text -- the e2e
// suite re-OCRs outgoing images separately (§18.1).
const SKIPPED_KEYS = new Set(['images']);

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (!SKIPPED_KEYS.has(key)) collectStrings(child, out);
    }
  }
}

export function scanResidualPii(observation: unknown, pageOrigin: string): ResidualScanResult {
  const strings: string[] = [];
  collectStrings(observation, strings);

  const hits: Partial<Record<ResidualKind, number>> = {};
  for (const text of strings) {
    for (const span of matchRegexSpans(text)) {
      let kind: ResidualKind = span.type;
      // The output has lost the Phase A context hints, so the heuristic can
      // only be re-scored on its content signals (role local part +3,
      // same-site domain +3, free-mail -4). Score > 0 means at least one
      // public signal: the email may legitimately have been kept public, so
      // it's reported apart from plain EMAIL hits for manual review.
      if (kind === 'EMAIL') {
        const email = text.slice(span.start, span.end);
        if (scorePublicEmail({ email, pageOrigin, hints: undefined, isMailtoHref: false }) > 0) kind = 'EMAIL_LIKELY_PUBLIC';
      }
      hits[kind] = (hits[kind] ?? 0) + 1;
    }
  }
  return { scanned_strings: strings.length, hits };
}
