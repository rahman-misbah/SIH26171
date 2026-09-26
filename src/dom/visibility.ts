// §5.3: visibility rules. `classifyVisibility` is a pure decision function
// over a pre-computed snapshot -- real layout (`getBoundingClientRect`,
// `getComputedStyle`) only means anything in a real browser engine, so
// `computeVisibilitySnapshot` (the live-DOM half) is unit-tested only for
// its style-attribute-driven branches and otherwise verified by the e2e
// suite against a real Chromium engine.

export interface VisibilitySnapshot {
  displayNone: boolean;
  visibilityHidden: boolean;
  zeroSize: boolean;
  offDocument: boolean;
  // The element itself is interactive (not just a descendant). A hidden
  // ancestor is kept because it contains something interactive (§5.3); that
  // interactive element itself must also survive for the same reason,
  // otherwise it would be re-stripped one level down for having "zero size"
  // (real browsers give hidden descendants a zero rect too).
  isInteractive: boolean;
  hasInteractiveDescendant: boolean;
  isLiveToggleTarget: boolean;
  isAriaLive: boolean;
  isVisuallyHiddenLabelled: boolean;
}

export type VisibilityResult = { kind: 'strip' } | { kind: 'keep'; visible: boolean };

export function classifyVisibility(snap: VisibilitySnapshot): VisibilityResult {
  const structurallyHidden = snap.displayNone || snap.visibilityHidden || snap.zeroSize || snap.offDocument;
  if (!structurallyHidden) return { kind: 'keep', visible: true };

  const hasLiveException =
    snap.isInteractive ||
    snap.hasInteractiveDescendant ||
    snap.isLiveToggleTarget ||
    snap.isAriaLive ||
    snap.isVisuallyHiddenLabelled;
  return hasLiveException ? { kind: 'keep', visible: false } : { kind: 'strip' };
}

// Tags stripped unconditionally, before any style check (§5.3).
export const ALWAYS_STRIPPED_TAGS = new Set(['script', 'style', 'noscript', 'template']);

// Interactive tags/roles used for the "has interactive descendant" and
// "target of a live toggle" exceptions.
const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'details']);
const INTERACTIVE_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'menuitem', 'tab', 'switch']);

function isInteractiveElement(el: Element): boolean {
  if (INTERACTIVE_TAGS.has(el.tagName.toLowerCase())) return true;
  const role = el.getAttribute('role');
  return role !== null && INTERACTIVE_ROLES.has(role);
}

export function hasInteractiveDescendant(el: Element): boolean {
  for (const descendant of el.querySelectorAll('*')) {
    if (isInteractiveElement(descendant)) return true;
  }
  return false;
}

// The element is the target of a live toggle elsewhere on the page
// (`aria-controls`, `<details>`, an `aria-expanded` owner) -- §5.3.
export function isLiveToggleTarget(el: Element, doc: Document): boolean {
  if (el.tagName.toLowerCase() === 'details') return true;
  if (el.id === '') return false;
  for (const owner of doc.querySelectorAll('[aria-controls]')) {
    const ids = (owner.getAttribute('aria-controls') ?? '').split(/\s+/);
    if (ids.includes(el.id)) return true;
  }
  return false;
}

export function computeVisibilitySnapshot(el: Element, doc: Document): VisibilitySnapshot {
  const style = doc.defaultView?.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const ariaLive = el.getAttribute('aria-live');
  const displayNone = style?.display === 'none';
  const visibilityHidden = style?.visibility === 'hidden';
  const zeroSize = rect.width === 0 && rect.height === 0;
  const offDocument = !el.isConnected;
  // M12: the exceptions below only change the outcome for a structurally
  // hidden element (classifyVisibility), and each is costly -- a subtree
  // scan, a document scan, the element's whole text. Computed for every
  // element they made Phase A quadratic (4.7 s on a Wikipedia article).
  const hidden = displayNone || visibilityHidden || zeroSize || offDocument;

  return {
    displayNone,
    visibilityHidden,
    zeroSize,
    offDocument,
    isInteractive: isInteractiveElement(el),
    hasInteractiveDescendant: hidden && hasInteractiveDescendant(el),
    isLiveToggleTarget: hidden && isLiveToggleTarget(el, doc),
    isAriaLive: ariaLive !== null && ariaLive !== 'off',
    // Best-effort: the common "sr-only" pattern (absolutely positioned,
    // clipped to ~0px) attached to a labelled control. No fixture exercises
    // this yet -- noted in the M5 Log as a corner case to revisit.
    isVisuallyHiddenLabelled:
      hidden &&
      style?.position === 'absolute' &&
      (style.width === '1px' || style.width === '0px') &&
      style.overflow === 'hidden' &&
      (el.textContent ?? '').trim() !== '',
  };
}
