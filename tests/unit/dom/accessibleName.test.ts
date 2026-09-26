// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { resolveAccessibleName } from '@/dom/accessibleName';

describe('resolveAccessibleName', () => {
  it('prefers aria-labelledby', () => {
    document.body.innerHTML = '<span id="lbl">Email address</span><input id="el" aria-labelledby="lbl" aria-label="ignored" />';
    expect(resolveAccessibleName(document.getElementById('el')!, document)).toBe('Email address');
  });

  it('falls back to aria-label', () => {
    document.body.innerHTML = '<button id="el" aria-label="Close dialog"></button>';
    expect(resolveAccessibleName(document.getElementById('el')!, document)).toBe('Close dialog');
  });

  it('falls back to label[for]', () => {
    document.body.innerHTML = '<label for="el">UPI ID</label><input id="el" />';
    expect(resolveAccessibleName(document.getElementById('el')!, document)).toBe('UPI ID');
  });

  it('matches label[for] on an id that is not a valid CSS string (M12, india.gov.in)', () => {
    // Real pages use ids with newlines, quotes and backslashes; a selector
    // built from them threw and failed the whole observation.
    document.body.innerHTML = '<label>District</label><input />';
    const input = document.querySelector('input')!;
    const label = document.querySelector('label')!;
    for (const id of ['One District\nOne Product', 'a"b', 'c\\d']) {
      input.id = id;
      label.htmlFor = id;
      expect(resolveAccessibleName(input, document)).toBe('District');
    }
  });

  it('falls back to a wrapping <label>', () => {
    document.body.innerHTML = '<label>Password <input id="el" type="password" /></label>';
    expect(resolveAccessibleName(document.getElementById('el')!, document)).toContain('Password');
  });

  it('falls back to alt', () => {
    document.body.innerHTML = '<img id="el" alt="Company logo" />';
    expect(resolveAccessibleName(document.getElementById('el')!, document)).toBe('Company logo');
  });

  it('falls back to title', () => {
    document.body.innerHTML = '<span id="el" title="More info"></span>';
    expect(resolveAccessibleName(document.getElementById('el')!, document)).toBe('More info');
  });

  it('returns empty string when nothing resolves', () => {
    document.body.innerHTML = '<div id="el"></div>';
    expect(resolveAccessibleName(document.getElementById('el')!, document)).toBe('');
  });
});
