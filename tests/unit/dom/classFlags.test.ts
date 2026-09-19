// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { semanticClassFlags } from '@/dom/classFlags';

function withClass(className: string): Element {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

describe('semanticClassFlags', () => {
  it('maps an error-ish class', () => {
    expect(semanticClassFlags(withClass('field-error'))).toEqual(['error']);
  });

  it('maps a disabled-ish class', () => {
    expect(semanticClassFlags(withClass('is-disabled'))).toEqual(['disabled']);
  });

  it('maps an active-ish class', () => {
    expect(semanticClassFlags(withClass('nav-item active'))).toContain('active');
  });

  it('maps a hidden-ish class', () => {
    expect(semanticClassFlags(withClass('d-none'))).toEqual(['hidden']);
  });

  it('can map multiple flags at once', () => {
    const flags = semanticClassFlags(withClass('is-disabled has-error'));
    expect(flags).toContain('disabled');
    expect(flags).toContain('error');
  });

  it('never returns raw class strings for unrecognized classes', () => {
    expect(semanticClassFlags(withClass('col-md-6 btn btn-primary'))).toEqual([]);
  });
});
