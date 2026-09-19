// §5.4: inside header/footer/banner/contentinfo/top-level nav, only
// interactive elements (and their accessible names) survive; non-interactive
// text and images are dropped. "Top-level nav" is read here as a <nav> not
// nested inside <main>/<article> (a site-nav vs. in-content-TOC distinction);
// the spec doesn't define the term further.

const LANDMARK_TAGS = new Set(['header', 'footer']);
const LANDMARK_ROLES = new Set(['banner', 'contentinfo']);

export function isTrimmedLandmarkRoot(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (LANDMARK_TAGS.has(tag)) return true;
  const role = el.getAttribute('role');
  if (role !== null && LANDMARK_ROLES.has(role)) return true;
  if (tag === 'nav') return el.closest('main, article') === null;
  return false;
}

export function findTrimmedLandmarkRoot(el: Element): Element | null {
  let node: Element | null = el;
  while (node) {
    if (isTrimmedLandmarkRoot(node)) return node;
    node = node.parentElement;
  }
  return null;
}
