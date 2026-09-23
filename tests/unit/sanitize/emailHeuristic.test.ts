import { describe, expect, it } from 'vitest';
import { isPublicEmail, scorePublicEmail } from '@/sanitize/emailHeuristic';
import type { ContextHints } from '@/dom/types';

const noHints: ContextHints = { in_landmark: false, near_contact_heading: false, in_contact_markup: false, in_ugc_block: false };

describe('scorePublicEmail', () => {
  it('scores +3 for a role local-part', () => {
    const score = scorePublicEmail({
      email: 'support@unrelated-domain.example',
      pageOrigin: 'https://example.com',
      hints: noHints,
      isMailtoHref: false,
    });
    expect(score).toBe(3);
  });

  it('scores +3 for a domain equal to the page origin', () => {
    const score = scorePublicEmail({
      email: 'priya@example.com',
      pageOrigin: 'https://example.com',
      hints: noHints,
      isMailtoHref: false,
    });
    expect(score).toBe(3);
  });

  it('scores +3 for a subdomain of the page origin', () => {
    const score = scorePublicEmail({
      email: 'priya@mail.example.com',
      pageOrigin: 'https://example.com',
      hints: noHints,
      isMailtoHref: false,
    });
    expect(score).toBe(3);
  });

  it('does not credit a domain that merely shares a suffix (not a real subdomain)', () => {
    const score = scorePublicEmail({
      email: 'priya@notexample.com',
      pageOrigin: 'https://example.com',
      hints: noHints,
      isMailtoHref: false,
    });
    expect(score).toBe(0);
  });

  it('scores -4 for a free-mail domain', () => {
    const score = scorePublicEmail({
      email: 'priya.sharma@gmail.com',
      pageOrigin: 'https://example.com',
      hints: noHints,
      isMailtoHref: false,
    });
    expect(score).toBe(-4);
  });

  it('scores +2 for schema.org contact markup', () => {
    const score = scorePublicEmail({
      email: 'random@unrelated-domain.example',
      pageOrigin: 'https://example.com',
      hints: { ...noHints, in_contact_markup: true },
      isMailtoHref: false,
    });
    expect(score).toBe(2);
  });

  it('scores +2 for a heading matching /contact|support|help/i nearby', () => {
    const score = scorePublicEmail({
      email: 'random@unrelated-domain.example',
      pageOrigin: 'https://example.com',
      hints: { ...noHints, near_contact_heading: true },
      isMailtoHref: false,
    });
    expect(score).toBe(2);
  });

  it('scores +2 for a mailto: link inside a landmark', () => {
    const score = scorePublicEmail({
      email: 'random@unrelated-domain.example',
      pageOrigin: 'https://example.com',
      hints: { ...noHints, in_landmark: true },
      isMailtoHref: true,
    });
    expect(score).toBe(2);
  });

  it('does not double-count in_landmark alone without a mailto href', () => {
    const score = scorePublicEmail({
      email: 'random@unrelated-domain.example',
      pageOrigin: 'https://example.com',
      hints: { ...noHints, in_landmark: true },
      isMailtoHref: false,
    });
    expect(score).toBe(0);
  });

  it('scores -3 for a UGC block', () => {
    const score = scorePublicEmail({
      email: 'random@unrelated-domain.example',
      pageOrigin: 'https://example.com',
      hints: { ...noHints, in_ugc_block: true },
      isMailtoHref: false,
    });
    expect(score).toBe(-3);
  });

  it('treats a missing hints object the same as all-false hints', () => {
    const score = scorePublicEmail({
      email: 'random@unrelated-domain.example',
      pageOrigin: 'https://example.com',
      hints: undefined,
      isMailtoHref: false,
    });
    expect(score).toBe(0);
  });

  it('is public (>=4) for contact.html-shaped input: role + own-domain + contact markup', () => {
    const input = {
      email: 'support@example.com',
      pageOrigin: 'https://example.com',
      hints: { in_landmark: true, near_contact_heading: true, in_contact_markup: true, in_ugc_block: false },
      isMailtoHref: true,
    };
    expect(scorePublicEmail(input)).toBe(3 + 3 + 2);
    expect(isPublicEmail(input)).toBe(true);
  });

  it('stays private (<4) for comments.html-shaped input: free-mail + UGC block', () => {
    const input = {
      email: 'priya.sharma.canary@example.com',
      pageOrigin: 'https://blog.example.org',
      hints: { in_landmark: false, near_contact_heading: false, in_contact_markup: false, in_ugc_block: true },
      isMailtoHref: false,
    };
    // Same domain as pageOrigin's registrable-ish host? No -- different origin
    // (blog.example.org vs example.com) so no +3 there either.
    expect(scorePublicEmail(input)).toBe(-3);
    expect(isPublicEmail(input)).toBe(false);
  });

  it('threshold is exactly >=4: a score of 3 stays private', () => {
    const input = {
      email: 'support@unrelated-domain.example',
      pageOrigin: 'https://different.example',
      hints: noHints,
      isMailtoHref: false,
    };
    expect(scorePublicEmail(input)).toBe(3);
    expect(isPublicEmail(input)).toBe(false);
  });
});
