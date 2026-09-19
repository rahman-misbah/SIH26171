// happy-dom (like jsdom) has no real layout engine -- every element's
// getBoundingClientRect() is zero. Phase A's §5.3 visibility rules need a
// plausible non-zero rect to tell "actually laid out" apart from
// "display:none", so this fakes just enough layout for unit tests. Real
// geometry is exercised by the Playwright e2e suite against a real Chromium
// engine -- this file is test-only, never imported from src/.

function fakeRect(w: number, h: number): DOMRect {
  return {
    x: 0,
    y: 0,
    width: w,
    height: h,
    top: 0,
    left: 0,
    right: w,
    bottom: h,
    toJSON() {
      return this;
    },
  } as DOMRect;
}

function isDisplayNone(start: Node | null): boolean {
  let node: Element | null = start instanceof Element ? start : start?.parentElement ?? null;
  for (; node; node = node.parentElement) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === 'none') return true;
  }
  return false;
}

export function installFakeLayout(): void {
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: Element): DOMRect {
      return isDisplayNone(this) ? fakeRect(0, 0) : fakeRect(100, 20);
    },
  });

  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: Range): DOMRect {
      return isDisplayNone(this.commonAncestorContainer) ? fakeRect(0, 0) : fakeRect(50, 16);
    },
  });
}
