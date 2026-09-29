// Demo tooling (M12): splits sanitized text into plain runs and the
// placeholders Edward put in it, so the viewer can highlight each one.
// Same placeholder grammar as src/sanitize/knownValues.ts.

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'token'; text: string; type: string } // [PII_<TYPE>_<n>], type e.g. 'EMAIL'
  | { kind: 'secret'; text: string }; // [SECRET]: a secret field, never read

const PLACEHOLDER_RE = /\[PII_([A-Z_]+)_\d+\]|\[SECRET\]/g;

export function splitPlaceholders(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER_RE)) {
    const start = match.index;
    if (start > last) out.push({ kind: 'text', text: text.slice(last, start) });
    const [whole, type] = match;
    out.push(type === undefined ? { kind: 'secret', text: whole } : { kind: 'token', text: whole, type });
    last = start + whole.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

// For the summary bar ("NAME 3, EMAIL 1, SECRET 2"): distinct tokens per
// type (the same token can appear on many nodes), and every [SECRET], since
// each one is a separate field that was never read.
export function countPlaceholders(texts: string[]): Record<string, number> {
  const tokens = new Map<string, string>();
  let secrets = 0;
  for (const text of texts) {
    for (const seg of splitPlaceholders(text)) {
      if (seg.kind === 'token') tokens.set(seg.text, seg.type);
      else if (seg.kind === 'secret') secrets++;
    }
  }
  const counts: Record<string, number> = {};
  for (const type of tokens.values()) counts[type] = (counts[type] ?? 0) + 1;
  if (secrets > 0) counts.SECRET = secrets;
  return counts;
}
