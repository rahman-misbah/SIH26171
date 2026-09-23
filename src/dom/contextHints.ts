// §7.5: structural-only context hints computed in Phase A (no content is
// read to produce these -- tag names, class names, `itemtype` attributes and
// heading *tag* presence are structure, not page content). Reused verbatim
// for every ContentUnit fanned out from the node in Phase B; the public-vs-
// private email heuristic (src/sanitize/emailHeuristic.ts) is the only
// consumer.

import { findTrimmedLandmarkRoot } from './landmark';
import type { ContextHints } from './types';

const CONTACT_HEADING_RE = /contact|support|help/i;
const CONTACT_ITEMTYPE_RE = /schema\.org\/(ContactPoint|Organization)\b/i;
const UGC_ITEMTYPE_RE = /schema\.org\/(Review|Comment|UserComments)\b/i;
const UGC_CLASS_RE = /\b(comment|review|forum-post|user-post)\b/i;

// Walks up from `el`, and at each ancestor level scans that ancestor's own
// preceding siblings for a heading whose text matches /contact|support|help/i
// -- catches contact.html's `<h1>Contact us</h1>` sibling-before-content
// shape. A loose, best-effort proxy for "under a heading" (§7.5 doesn't
// define the term further); bounded implicitly by walking only to
// `document.body` (its own previousElementSibling chain is empty).
function hasNearbyContactHeading(el: Element): boolean {
  for (let ancestor: Element | null = el; ancestor; ancestor = ancestor.parentElement) {
    for (let sib = ancestor.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (/^h[1-6]$/i.test(sib.tagName) && CONTACT_HEADING_RE.test(sib.textContent ?? '')) return true;
    }
    if (ancestor.tagName === 'BODY') break;
  }
  return false;
}

function isInContactMarkup(el: Element): boolean {
  for (let ancestor: Element | null = el; ancestor; ancestor = ancestor.parentElement) {
    const itemtype = ancestor.getAttribute('itemtype');
    if (itemtype && CONTACT_ITEMTYPE_RE.test(itemtype)) return true;
  }
  return false;
}

function isInUgcBlock(el: Element): boolean {
  for (let ancestor: Element | null = el; ancestor; ancestor = ancestor.parentElement) {
    const itemtype = ancestor.getAttribute('itemtype');
    if (itemtype && UGC_ITEMTYPE_RE.test(itemtype)) return true;
    if (UGC_CLASS_RE.test(ancestor.className)) return true;
  }
  return false;
}

export function computeContextHints(el: Element): ContextHints {
  return {
    in_landmark: findTrimmedLandmarkRoot(el) !== null,
    near_contact_heading: hasNearbyContactHeading(el),
    in_contact_markup: isInContactMarkup(el),
    in_ugc_block: isInUgcBlock(el),
  };
}
