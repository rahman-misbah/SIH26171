// §5.5: no raw class values ever leave Phase A. This maps `classList` entries
// onto the small whitelist of semantic flags (§5.1's `flags` field) by
// substring match -- the mapping itself is an implementer choice (the spec
// only mandates the whitelist, not a literal pattern table).

import type { SemanticFlag } from './types';

const FLAG_PATTERNS: [SemanticFlag, RegExp][] = [
  ['error', /error|invalid/i],
  ['disabled', /disabled/i],
  ['active', /\bactive\b|\bselected\b|\bcurrent\b/i],
  ['hidden', /\bhidden\b|d-none|invisible/i],
];

export function semanticClassFlags(el: Element): SemanticFlag[] {
  const flags = new Set<SemanticFlag>();
  for (const className of el.classList) {
    for (const [flag, pattern] of FLAG_PATTERNS) {
      if (pattern.test(className)) flags.add(flag);
    }
  }
  return [...flags];
}
