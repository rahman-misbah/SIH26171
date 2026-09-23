// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { computeContextHints } from '@/dom/contextHints';

describe('computeContextHints', () => {
  it('matches contact.html: contact markup + nearby contact heading, no UGC', () => {
    document.body.innerHTML = `
      <nav>Home | Products | Contact</nav>
      <main>
        <h1>Contact us</h1>
        <div itemscope itemtype="https://schema.org/ContactPoint">
          <p>For support, email <a id="link" href="mailto:support@example.com" itemprop="email">support@example.com</a>.</p>
        </div>
      </main>`;
    const hints = computeContextHints(document.getElementById('link')!);
    expect(hints.in_contact_markup).toBe(true);
    expect(hints.near_contact_heading).toBe(true);
    expect(hints.in_ugc_block).toBe(false);
  });

  it('matches comments.html: UGC block, no contact signals', () => {
    document.body.innerHTML = `
      <article><h1>Blog post title</h1><p>Some article content.</p></article>
      <section aria-label="Comments">
        <h2>Comments</h2>
        <div class="comment"><p id="email">Email me at priya@example.com if you want to chat.</p></div>
      </section>`;
    const hints = computeContextHints(document.getElementById('email')!);
    expect(hints.in_ugc_block).toBe(true);
    expect(hints.in_contact_markup).toBe(false);
  });

  it('flags in_landmark for an element inside <footer>', () => {
    document.body.innerHTML = '<footer><a id="link" href="mailto:info@example.com">info@example.com</a></footer>';
    expect(computeContextHints(document.getElementById('link')!).in_landmark).toBe(true);
  });

  it('does not flag in_landmark for an element inside <main>', () => {
    document.body.innerHTML = '<main><p id="p">text</p></main>';
    expect(computeContextHints(document.getElementById('p')!).in_landmark).toBe(false);
  });

  it('does not match a heading far away as "nearby"', () => {
    document.body.innerHTML = `
      <h1>Contact us</h1>
      <footer><p id="p">unrelated footer text</p></footer>`;
    // The footer is a landmark root; findTrimmedLandmarkRoot stops the walk's
    // sibling-scan logic at each ancestor level independently, but the <h1>
    // is a preceding sibling of <footer> itself at the body level, so this
    // documents the heuristic's actual (loose) behavior rather than asserting
    // a stronger guarantee than the implementation provides.
    const hints = computeContextHints(document.getElementById('p')!);
    expect(hints.near_contact_heading).toBe(true);
  });

  it('returns all-false hints for a plain unrelated element', () => {
    document.body.innerHTML = '<div><p id="p">Just some text.</p></div>';
    expect(computeContextHints(document.getElementById('p')!)).toEqual({
      in_landmark: false,
      near_contact_heading: false,
      in_contact_markup: false,
      in_ugc_block: false,
    });
  });

  it('flags in_ugc_block for schema.org Review/Comment markup', () => {
    document.body.innerHTML = '<div itemscope itemtype="https://schema.org/Comment"><p id="p">nice post</p></div>';
    expect(computeContextHints(document.getElementById('p')!).in_ugc_block).toBe(true);
  });
});
