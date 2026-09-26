// M12 (§7.6): finds values already tokenized on this origin, verbatim, so
// they are masked before NER and get their existing token. Found on httpbin:
// the task's "First Last" was one NAME token, but once typed into the form,
// NER read the bare field value as two names and minted two new tokens -- the
// agent no longer saw the token it typed. It also means a value NER tagged
// once is caught again where NER misses it later in the session.

import type { RegexSpan } from './regex';
import type { PiiType } from './types';

// Shorter values are skipped: a single NER false positive on a short common
// word would otherwise be tokenized everywhere on the origin for the rest of
// the session. 3 still covers short names ("Ram", "Anu"); NER runs on
// everything regardless.
export const MIN_KNOWN_VALUE_LENGTH = 3;

// Letters, digits and `_` count as word characters, so a value never matches
// inside a longer word ("Priya" in "Priyanka") or inside a token's name.
const WORD_CHAR = /[\p{L}\p{N}_]/u;
// Text that is already a token or a secret placeholder is never re-matched.
const PLACEHOLDER_RE = /\[PII_[A-Z_]+_\d+\]|\[SECRET\]/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findKnownValues(text: string, known: { type: PiiType; value: string }[]): RegexSpan[] {
  const placeholders = [...text.matchAll(PLACEHOLDER_RE)].map((m) => [m.index, m.index + m[0].length] as const);
  const inPlaceholder = (start: number, end: number) => placeholders.some(([s, e]) => start < e && s < end);
  const isBoundary = (i: number) => i < 0 || i >= text.length || !WORD_CHAR.test(text[i]!);

  const candidates: RegexSpan[] = [];
  for (const { type, value } of known) {
    const trimmed = value.trim();
    if (trimmed.length < MIN_KNOWN_VALUE_LENGTH) continue;
    for (const m of text.matchAll(new RegExp(escapeRegExp(trimmed), 'giu'))) {
      const start = m.index;
      const end = start + m[0].length;
      if (isBoundary(start - 1) && isBoundary(end) && !inPlaceholder(start, end)) candidates.push({ type, start, end });
    }
  }

  // Longest first, so "Priya Sharma" wins over "Priya" at the same place.
  candidates.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const chosen: RegexSpan[] = [];
  for (const span of candidates) {
    if (!chosen.some((c) => span.start < c.end && c.start < span.end)) chosen.push(span);
  }
  return chosen.sort((a, b) => a.start - b.start);
}
