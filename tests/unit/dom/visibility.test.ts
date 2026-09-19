// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import {
  classifyVisibility,
  hasInteractiveDescendant,
  isLiveToggleTarget,
  type VisibilitySnapshot,
} from '@/dom/visibility';

function snap(overrides: Partial<VisibilitySnapshot> = {}): VisibilitySnapshot {
  return {
    displayNone: false,
    visibilityHidden: false,
    zeroSize: false,
    offDocument: false,
    isInteractive: false,
    hasInteractiveDescendant: false,
    isLiveToggleTarget: false,
    isAriaLive: false,
    isVisuallyHiddenLabelled: false,
    ...overrides,
  };
}

describe('classifyVisibility', () => {
  it('keeps a normally visible node', () => {
    expect(classifyVisibility(snap())).toEqual({ kind: 'keep', visible: true });
  });

  it('strips display:none with no exception', () => {
    expect(classifyVisibility(snap({ displayNone: true }))).toEqual({ kind: 'strip' });
  });

  it('strips a zero-size, off-document node', () => {
    expect(classifyVisibility(snap({ zeroSize: true, offDocument: true }))).toEqual({ kind: 'strip' });
  });

  it('keeps a hidden node with an interactive descendant, marked not visible', () => {
    expect(classifyVisibility(snap({ visibilityHidden: true, hasInteractiveDescendant: true }))).toEqual({
      kind: 'keep',
      visible: false,
    });
  });

  it('keeps a hidden node that is a live-toggle target', () => {
    expect(classifyVisibility(snap({ displayNone: true, isLiveToggleTarget: true }))).toEqual({
      kind: 'keep',
      visible: false,
    });
  });

  it('keeps a hidden aria-live region', () => {
    expect(classifyVisibility(snap({ displayNone: true, isAriaLive: true }))).toEqual({
      kind: 'keep',
      visible: false,
    });
  });
});

describe('hasInteractiveDescendant', () => {
  it('finds a button nested inside a wrapper', () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<div><button>click</button></div>';
    expect(hasInteractiveDescendant(wrapper)).toBe(true);
  });

  it('returns false when there is nothing interactive inside', () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<p>just text</p>';
    expect(hasInteractiveDescendant(wrapper)).toBe(false);
  });

  it('finds an element with an interactive ARIA role', () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<span role="button">go</span>';
    expect(hasInteractiveDescendant(wrapper)).toBe(true);
  });
});

describe('isLiveToggleTarget', () => {
  it('is true for a <details> element', () => {
    const details = document.createElement('details');
    expect(isLiveToggleTarget(details, document)).toBe(true);
  });

  it('is true for an element referenced by another element\'s aria-controls', () => {
    document.body.innerHTML = '<button aria-controls="panel-1">Toggle</button><div id="panel-1">content</div>';
    const panel = document.getElementById('panel-1')!;
    expect(isLiveToggleTarget(panel, document)).toBe(true);
  });

  it('is false for an unrelated element', () => {
    document.body.innerHTML = '<div id="unrelated">content</div>';
    const el = document.getElementById('unrelated')!;
    expect(isLiveToggleTarget(el, document)).toBe(false);
  });
});
