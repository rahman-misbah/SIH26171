// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { ElementRegistry } from '@/dom/registry';

describe('ElementRegistry', () => {
  it('resolves a registered node back to its element', () => {
    const registry = new ElementRegistry();
    const el = document.createElement('button');
    registry.register('n1', el);
    expect(registry.resolve('n1')).toBe(el);
  });

  it('returns undefined for an unknown node id', () => {
    const registry = new ElementRegistry();
    expect(registry.resolve('n404')).toBeUndefined();
  });

  it('forgets everything after clear()', () => {
    const registry = new ElementRegistry();
    registry.register('n1', document.createElement('div'));
    registry.clear();
    expect(registry.resolve('n1')).toBeUndefined();
  });
});
