// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { findTrimmedLandmarkRoot, isTrimmedLandmarkRoot } from '@/dom/landmark';

describe('isTrimmedLandmarkRoot', () => {
  it('flags <header> and <footer>', () => {
    expect(isTrimmedLandmarkRoot(document.createElement('header'))).toBe(true);
    expect(isTrimmedLandmarkRoot(document.createElement('footer'))).toBe(true);
  });

  it('flags role=banner / role=contentinfo', () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'banner');
    expect(isTrimmedLandmarkRoot(el)).toBe(true);
  });

  it('flags a top-level <nav>', () => {
    document.body.innerHTML = '<nav id="topnav">Home</nav>';
    expect(isTrimmedLandmarkRoot(document.getElementById('topnav')!)).toBe(true);
  });

  it('does not flag a <nav> nested inside <main>', () => {
    document.body.innerHTML = '<main><nav id="toc">On this page</nav></main>';
    expect(isTrimmedLandmarkRoot(document.getElementById('toc')!)).toBe(false);
  });

  it('does not flag an ordinary div', () => {
    expect(isTrimmedLandmarkRoot(document.createElement('div'))).toBe(false);
  });
});

describe('findTrimmedLandmarkRoot', () => {
  it('finds the nearest landmark ancestor', () => {
    document.body.innerHTML = '<footer><div><a id="link" href="/">Home</a></div></footer>';
    const link = document.getElementById('link')!;
    expect(findTrimmedLandmarkRoot(link)?.tagName.toLowerCase()).toBe('footer');
  });

  it('returns null outside any landmark', () => {
    document.body.innerHTML = '<main><p id="p">text</p></main>';
    expect(findTrimmedLandmarkRoot(document.getElementById('p')!)).toBeNull();
  });
});
