// §9.3: character-offset reconstruction for Transformers.js's token-
// classification output. Verified directly against the real downloaded
// model while building this provider: neither the raw per-token output nor
// the aggregated `entity_group` output carries character offsets -- only
// lowercased wordpiece fragments (`word`), with spaces inserted at every
// subword boundary (so the aggregated `word` is not even a substring of the
// original text). There is no offset-mapping API anywhere in the library
// (checked the tokenizer classes directly), unlike HF's Python fast
// tokenizers. This is the standard workaround: walk the ORIGINAL text and
// the FULL token stream (including non-entity 'O' tokens -- call the
// pipeline with `ignore_labels: []`, otherwise there's no way to know how
// much text separates two entity tokens) together, greedily re-matching
// each wordpiece fragment back to a substring.
//
// Failure mode when a token can't be re-matched (unicode normalization/
// accent-stripping mismatch, an unexpected special character): that one
// token is dropped rather than assigned a guessed position. This can only
// ever shrink a detected span, never misplace one -- the independent regex
// tier (§7.1) is unaffected either way, so this is a recall/precision
// tradeoff internal to the NER tier, not a fail-open risk.

export interface RawNerToken {
  entity: string; // BIO-tagged, e.g. 'B-PERSON', 'O'
  score: number;
  word: string; // lowercased wordpiece fragment; '##' prefix = no-space continuation
}

export interface AlignedNerToken {
  entity: string;
  score: number;
  start: number;
  end: number;
}

// How far past the cursor to search for a new (non-continuation) token's
// text, to tolerate whitespace runs or punctuation the tokenizer stripped.
const LOOKAHEAD_CHARS = 32;

export function alignTokensToText(text: string, tokens: RawNerToken[]): AlignedNerToken[] {
  const lower = text.toLowerCase();
  const aligned: AlignedNerToken[] = [];
  let cursor = 0;

  for (const token of tokens) {
    const isContinuation = token.word.startsWith('##');
    const piece = isContinuation ? token.word.slice(2) : token.word;
    if (piece === '') continue;

    // A continuation token must attach with zero gap right after the
    // previous piece; a new token may be preceded by whitespace/punctuation
    // the tokenizer dropped, so it gets a lookahead window instead.
    const windowEnd = isContinuation
      ? Math.min(lower.length, cursor + piece.length)
      : Math.min(lower.length, cursor + piece.length + LOOKAHEAD_CHARS);
    const window = lower.slice(cursor, windowEnd);
    const foundAt = window.indexOf(piece);
    if (foundAt === -1) continue;

    const start = cursor + foundAt;
    const end = start + piece.length;
    aligned.push({ entity: token.entity, score: token.score, start, end });
    cursor = end;
  }

  return aligned;
}

export interface GroupedNerSpan {
  label: string; // raw tag, e.g. 'PERSON' -- caller maps to PiiType (labelMap.ts)
  start: number;
  end: number;
  score: number; // averaged over the group's tokens
}

function splitTag(entity: string): { prefix: string; tag: string | null } {
  if (entity === 'O') return { prefix: 'O', tag: null };
  const dash = entity.indexOf('-');
  if (dash === -1) return { prefix: entity, tag: null };
  return { prefix: entity.slice(0, dash), tag: entity.slice(dash + 1) };
}

// Mirrors Transformers.js's own `simple` aggregation strategy (adjacent
// same-tag I-/B- tokens merge; a B- immediately after another B- of the
// same tag starts a NEW group, matching the library's exact behavior --
// confirmed against its source and against a real model run where a
// two-word name came back as two separate PERSON groups for this reason).
export function groupAlignedTokens(tokens: AlignedNerToken[]): GroupedNerSpan[] {
  const groups: { tag: string; start: number; end: number; scoreSum: number; count: number }[] = [];
  let openTag: string | null = null;

  for (const token of tokens) {
    const { prefix, tag } = splitTag(token.entity);
    if (tag === null) {
      openTag = null;
      continue;
    }
    const extend = openTag === tag && prefix !== 'B' && prefix !== 'S';
    if (extend) {
      const group = groups[groups.length - 1]!;
      group.end = token.end;
      group.scoreSum += token.score;
      group.count += 1;
    } else {
      groups.push({ tag, start: token.start, end: token.end, scoreSum: token.score, count: 1 });
    }
    openTag = prefix === 'S' || prefix === 'E' ? null : tag;
  }

  return groups.map((g) => ({ label: g.tag, start: g.start, end: g.end, score: g.scoreSum / g.count }));
}
