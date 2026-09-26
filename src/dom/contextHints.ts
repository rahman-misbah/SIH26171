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
//
// M12: the walks are memoized per element for one Phase A run
// (createContextHints). Unmemoized, every text node re-scanned every
// ancestor's preceding siblings -- quadratic on a long article.
type Memo = Map<Element, boolean>;

function memoized(memo: Memo, el: Element, compute: () => boolean): boolean {
  let value = memo.get(el);
  if (value === undefined) {
    value = compute();
    memo.set(el, value);
  }
  return value;
}

export function createContextHints(): (el: Element) => ContextHints {
  const headingBefore: Memo = new Map(); // a matching heading among el's preceding siblings
  const nearHeading: Memo = new Map();
  const contactMarkup: Memo = new Map();
  const ugc: Memo = new Map();

  // Iterative (a parent can have thousands of children): walk back until a
  // memoized sibling or a matching heading, then fill in the walked ones.
  const hasContactHeadingBefore = (el: Element): boolean => {
    const walked: Element[] = [];
    let result = false;
    for (let current: Element = el; ; ) {
      const cached = headingBefore.get(current);
      if (cached !== undefined) {
        result = cached;
        break;
      }
      walked.push(current);
      const sib = current.previousElementSibling;
      if (!sib) break;
      if (/^h[1-6]$/i.test(sib.tagName) && CONTACT_HEADING_RE.test(sib.textContent ?? '')) {
        result = true;
        break;
      }
      current = sib;
    }
    for (const w of walked) headingBefore.set(w, result);
    return result;
  };

  const hasNearbyContactHeading = (el: Element): boolean =>
    memoized(nearHeading, el, () => {
      if (hasContactHeadingBefore(el)) return true;
      if (el.tagName === 'BODY' || !el.parentElement) return false;
      return hasNearbyContactHeading(el.parentElement);
    });

  const isInContactMarkup = (el: Element): boolean =>
    memoized(contactMarkup, el, () => {
      const itemtype = el.getAttribute('itemtype');
      if (itemtype && CONTACT_ITEMTYPE_RE.test(itemtype)) return true;
      return el.parentElement ? isInContactMarkup(el.parentElement) : false;
    });

  const isInUgcBlock = (el: Element): boolean =>
    memoized(ugc, el, () => {
      const itemtype = el.getAttribute('itemtype');
      if (itemtype && UGC_ITEMTYPE_RE.test(itemtype)) return true;
      if (UGC_CLASS_RE.test(el.className)) return true;
      return el.parentElement ? isInUgcBlock(el.parentElement) : false;
    });

  return (el) => ({
    in_landmark: findTrimmedLandmarkRoot(el) !== null,
    near_contact_heading: hasNearbyContactHeading(el),
    in_contact_markup: isInContactMarkup(el),
    in_ugc_block: isInUgcBlock(el),
  });
}

export function computeContextHints(el: Element): ContextHints {
  return createContextHints()(el);
}
