// M12: §14.2's budget ("trim non-interactive text from off-viewport regions
// first and mark truncated: true"), applied *before* sanitization instead of
// after it (user decision, M12 Log). On real pages NER over every unit took
// 28-95 s per observation; content past the budget is now never sanitized
// and never leaves the content script. Fail-closed by construction: the
// budget only ever removes content, and each removal is flagged (§2.10).
//
// Order, most important first:
//   1. in-viewport interactive content (a link's text, a button's name, an
//      input's placeholder/value) -- what the agent can act on right now;
//   2. other in-viewport text;
//   3. off-viewport content, nearest to the viewport first (interactive first
//      on a tie) -- what one scroll would reveal;
//   4. content of nodes kept with visible:false (§5.3), last.
// Units are kept whole per (node, field): a long text's windows (§5.2) are
// all kept or all dropped, so the assembler can still merge them.

import { INTERACTIVE_ROLES, INTERACTIVE_TAGS } from './skeleton';
import type { ContentField, ContentUnit, SkeletonNode } from './types';

// §14.2: "a token budget (e.g. <= 40% of maxContextTokens)".
const CONTEXT_FRACTION = 0.4;
// Rough English average for BPE tokenizers; only used to turn the token
// budget into characters, the unit the content script can count.
const CHARS_PER_TOKEN = 4;
// §14.2: "much less in practice for latency". ~3,000 tokens of page text.
// Chosen from the M12 real-site pass: on the dev laptop NER sanitizes about
// 50 units/s, so this plus MAX_BUDGET_UNITS keeps a busy page to a few
// seconds. It also sits under 40% of the smallest shipped context (the mock
// backend's 8,192 tokens -> 13,104 chars).
export const LATENCY_CHAR_CAP = 12_000;
// NER cost is per sequence as much as per character (each unit is one
// sequence in a micro-batch), so the unit count is capped too: 300 units is
// under 20 micro-batches of 16 (§7.2).
export const MAX_BUDGET_UNITS = 300;

export function contentCharBudget(maxContextTokens: number): number {
  return Math.min(Math.floor(maxContextTokens * CONTEXT_FRACTION) * CHARS_PER_TOKEN, LATENCY_CHAR_CAP);
}

export interface ContentBudget {
  maxChars: number;
  maxUnits: number;
  viewportHeight: number;
}

// Identifies one (node, field) pair; NUL can't appear in a node id.
export function trimKey(node_id: string, field: ContentField): string {
  return `${node_id}\u0000${field}`;
}

function isInteractiveNode(node: SkeletonNode): boolean {
  return INTERACTIVE_TAGS.has(node.tag) || (node.role !== undefined && INTERACTIVE_ROLES.has(node.role));
}

// Distance in px between a viewport-relative box and the viewport (0 inside).
function distanceFromViewport(node: SkeletonNode, viewportHeight: number): number {
  const top = node.bbox.y;
  const bottom = node.bbox.y + node.bbox.h;
  if (bottom <= 0) return -bottom;
  if (top >= viewportHeight) return top - viewportHeight;
  return 0;
}

interface Group {
  key: string;
  units: ContentUnit[];
  chars: number;
  tier: number;
  distance: number;
  interactive: boolean;
  order: number;
}

export function selectUnits(
  skeleton: SkeletonNode[],
  units: ContentUnit[],
  budget: ContentBudget,
): { kept: ContentUnit[]; trimmed: Set<string> } {
  const byId = new Map(skeleton.map((n) => [n.node_id, n]));

  // A text node counts as interactive when it sits inside a link/button
  // (its accessible name comes from that text).
  const interactiveMemo = new Map<string, boolean>();
  const insideInteractive = (node: SkeletonNode): boolean => {
    const cached = interactiveMemo.get(node.node_id);
    if (cached !== undefined) return cached;
    const parent = node.parent_id === null ? undefined : byId.get(node.parent_id);
    const result = isInteractiveNode(node) || (parent !== undefined && insideInteractive(parent));
    interactiveMemo.set(node.node_id, result);
    return result;
  };

  const groups = new Map<string, Group>();
  for (const unit of units) {
    const key = trimKey(unit.node_id, unit.field);
    const existing = groups.get(key);
    if (existing) {
      existing.units.push(unit);
      existing.chars += unit.text.length;
      continue;
    }
    const node = byId.get(unit.node_id);
    const interactive = node !== undefined && insideInteractive(node);
    const distance = node ? distanceFromViewport(node, budget.viewportHeight) : Number.POSITIVE_INFINITY;
    let tier: number;
    if (!node || !node.visible) tier = 3;
    else if (distance === 0) tier = interactive ? 0 : 1;
    else tier = 2;
    groups.set(key, { key, units: [unit], chars: unit.text.length, tier, distance, interactive, order: groups.size });
  }

  const ranked = [...groups.values()].sort(
    (a, b) =>
      a.tier - b.tier ||
      (a.tier >= 2 ? a.distance - b.distance : 0) ||
      Number(b.interactive) - Number(a.interactive) ||
      a.order - b.order,
  );

  const keptUnitIds = new Set<string>();
  const trimmed = new Set<string>();
  let chars = 0;
  let count = 0;
  let full = false;
  for (const group of ranked) {
    // Stop at the first group that doesn't fit: a smaller one further away
    // must not jump ahead of nearer content.
    if (!full && chars + group.chars <= budget.maxChars && count + group.units.length <= budget.maxUnits) {
      chars += group.chars;
      count += group.units.length;
      for (const unit of group.units) keptUnitIds.add(unit.unit_id);
    } else {
      full = true;
      trimmed.add(group.key);
    }
  }

  return { kept: units.filter((u) => keptUnitIds.has(u.unit_id)), trimmed };
}

// After a trimmed observation: drop nodes that no longer carry anything the
// agent can use, so the skeleton shrinks with the text (thousands of empty
// off-viewport nodes would otherwise fill the backend's context). A node is
// kept if it has kept content, is a secret field, carries an exclusion marker,
// is an image in the viewport or still eligible to be sent, is interactive
// and in the viewport, or is an ancestor of a
// kept node (so every parent_id still resolves). Each dropped or partly
// trimmed node's content, and each dropped interactive node, is flagged
// `trimmed` on itself if kept, or on its nearest kept ancestor. Returns new objects for flagged nodes; never
// mutates `skeleton` (the image pipeline shares those objects).
export function pruneSkeleton(skeleton: SkeletonNode[], kept: ContentUnit[], trimmed: Set<string>): SkeletonNode[] {
  if (trimmed.size === 0) return skeleton;

  const byId = new Map(skeleton.map((n) => [n.node_id, n]));
  const hasKeptContent = new Set(kept.map((u) => u.node_id));
  // An image node off the viewport that the image pipeline already left out
  // (too_small, unreadable...) carries nothing but its marker; it goes too,
  // its exclusion flagged on the ancestor like trimmed text.
  const isDroppableImage = (node: SkeletonNode): boolean => !node.in_viewport && node.image_omitted !== undefined;
  const hasTrimmedContent = new Set<string>();
  for (const node of skeleton) {
    if (node.image !== undefined && isDroppableImage(node)) hasTrimmedContent.add(node.node_id);
    else if (node.pending_content.some((field) => trimmed.has(trimKey(node.node_id, field)))) hasTrimmedContent.add(node.node_id);
  }

  const keep = new Set<string>();
  for (const node of skeleton) {
    const own =
      hasKeptContent.has(node.node_id) ||
      node.secret === true ||
      node.marker !== undefined ||
      (node.image !== undefined && !isDroppableImage(node)) ||
      (isInteractiveNode(node) && node.in_viewport);
    if (!own) continue;
    // Mark this node and its ancestors; stop at one already marked.
    let current: SkeletonNode | undefined = node;
    while (current && !keep.has(current.node_id)) {
      keep.add(current.node_id);
      current = current.parent_id === null ? undefined : byId.get(current.parent_id);
    }
  }

  // A dropped control with no content of its own (an unlabelled off-viewport
  // checkbox) is something the agent could act on, so its removal is
  // flagged like trimmed text (§2.10).
  for (const node of skeleton) {
    if (isInteractiveNode(node) && !keep.has(node.node_id)) hasTrimmedContent.add(node.node_id);
  }

  const flagged = new Set<string>();
  for (const id of hasTrimmedContent) {
    let current = byId.get(id);
    while (current && !keep.has(current.node_id)) {
      current = current.parent_id === null ? undefined : byId.get(current.parent_id);
    }
    if (current) flagged.add(current.node_id);
  }

  return skeleton.filter((n) => keep.has(n.node_id)).map((n) => (flagged.has(n.node_id) ? { ...n, trimmed: true } : n));
}
