// §5.2 Phase B: fan each pending content field out to its own ContentUnit.
// This is the only place raw text is actually read in the content script --
// Phase A only flagged *presence*. Units are windowed here and re-merged
// (§14) after sanitization; raw text is dropped from this module's return
// value once the caller has sent it (per-unit, not retained).

import { resolveAccessibleName } from './accessibleName';
import { createIdGenerator } from './ids';
import type { ElementRegistry } from './registry';
import type { ContentField, ContentUnit, SkeletonNode } from './types';

// §5.2: text nodes over this length are split into overlapping windows so no
// unit exceeds the NER model's sequence length.
export const TEXT_WINDOW_SIZE = 2000;
export const TEXT_WINDOW_OVERLAP = 50;

export function windowText(text: string): string[] {
  if (text.length <= TEXT_WINDOW_SIZE) return [text];
  const windows: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + TEXT_WINDOW_SIZE, text.length);
    windows.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - TEXT_WINDOW_OVERLAP;
  }
  return windows;
}

// Reassembles sanitized windows back into one string for the node. This is
// an approximation (it trusts the overlap length rather than re-detecting
// it post-sanitization, since a token can change the character count inside
// the overlapping region) -- acceptable because a rare duplicated word at a
// seam is a cosmetic issue, never a privacy one, and no fixture in M5/M7
// exercises text this long. Revisit if real-site testing (M12) shows it matters.
export function mergeWindows(sanitizedWindows: string[]): string {
  if (sanitizedWindows.length === 0) return '';
  let result = sanitizedWindows[0] ?? '';
  for (let i = 1; i < sanitizedWindows.length; i++) {
    const w = sanitizedWindows[i] ?? '';
    result += w.slice(Math.min(TEXT_WINDOW_OVERLAP, w.length));
  }
  return result;
}

function isInlineData(value: string): boolean {
  return value.startsWith('data:') || value.startsWith('blob:');
}

function readElementField(el: Element, field: Exclude<ContentField, 'text'>): string {
  switch (field) {
    case 'value':
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : '';
    case 'placeholder':
      return el.getAttribute('placeholder') ?? '';
    case 'accessible_name':
      return resolveAccessibleName(el, el.ownerDocument);
    case 'href':
    case 'src': {
      // §5.1: data:/blob: URLs are replaced, never sent as content.
      const raw = el.getAttribute(field) ?? '';
      return isInlineData(raw) ? '[inline-data]' : raw;
    }
  }
}

export function buildContentUnits(
  skeleton: SkeletonNode[],
  registry: ElementRegistry,
  textNodes: ReadonlyMap<string, Text>,
): ContentUnit[] {
  const nextUnitId = createIdGenerator('u');
  const units: ContentUnit[] = [];

  for (const node of skeleton) {
    for (const field of node.pending_content) {
      if (field === 'text') {
        const raw = textNodes.get(node.node_id)?.textContent ?? '';
        for (const window of windowText(raw)) {
          units.push({ unit_id: nextUnitId(), node_id: node.node_id, field: 'text', text: window, context: node.context_hints });
        }
        continue;
      }

      const el = registry.resolve(node.node_id);
      if (!el) continue;
      const raw = readElementField(el, field);
      if (raw === '') continue;
      units.push({ unit_id: nextUnitId(), node_id: node.node_id, field, text: raw, context: node.context_hints });
    }
  }

  return units;
}
