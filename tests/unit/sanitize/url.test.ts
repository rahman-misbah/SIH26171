// §7.8 URL sanitization, exercised against the query-links.html canary
// fixture's values (§18 item 1).

import { describe, expect, it } from 'vitest';
import { TokenMapImpl } from '@/sanitize/tokenMap';
import { sanitizeUrl } from '@/sanitize/url';

function ctx() {
  return { origin: 'http://localhost/', tokenMap: new TokenMapImpl(), node_id: 'n1', field: 'href' };
}

describe('sanitizeUrl', () => {
  it('keeps scheme and path, and redacts the "email" query key regardless of content (sensitive key, §7.8)', async () => {
    const out = await sanitizeUrl('https://example.com/reset?email=priya.sharma.canary%40example.com', ctx());
    expect(out.startsWith('https://example.com/reset?')).toBe(true);
    expect(out).not.toContain('priya.sharma.canary');
    expect(out).toContain('PII_OTHER_1');
  });

  it('redacts a sensitive query key regardless of its content', async () => {
    const out = await sanitizeUrl('https://example.com/session?token=eyCanaryTok3n.abcDEF456', ctx());
    expect(out).not.toContain('eyCanaryTok3n');
    expect(out).toContain('PII_OTHER_1');
  });

  it('redacts the "phone" query key regardless of content (sensitive key, §7.8)', async () => {
    const out = await sanitizeUrl('https://example.com/profile?phone=%2B919876543210', ctx());
    expect(out).not.toContain('919876543210');
    expect(out).toContain('PII_OTHER_1');
  });

  it('still detects a phone number by regex when it is NOT under a sensitive key', async () => {
    const out = await sanitizeUrl('https://example.com/profile?contactNumber=%2B919876543210', ctx());
    expect(out).not.toContain('919876543210');
    expect(out).toContain('PII_PHONE_1');
  });

  it('keeps a non-PII query value untouched', async () => {
    const out = await sanitizeUrl('https://example.com/search?q=hello+world', ctx());
    expect(out).toContain('q=hello');
  });

  it('sanitizes a PII-shaped path segment', async () => {
    const out = await sanitizeUrl('https://example.com/users/priya.sharma.canary%40example.com/profile', ctx());
    expect(out).not.toContain('priya.sharma.canary');
    expect(out).toContain('/users/%5BPII_EMAIL_1%5D/profile');
  });

  it('drops a long/opaque fragment', async () => {
    const out = await sanitizeUrl('https://example.com/page#some-internal-tracking-blob-abc123xyz987', ctx());
    expect(out).not.toContain('#');
  });

  it('keeps a short in-page anchor fragment', async () => {
    const out = await sanitizeUrl('https://example.com/page#section-2', ctx());
    expect(out).toContain('#section-2');
  });

  it('reuses the shared token map, so a query value resolves back to the raw PII (stability, §7.6)', async () => {
    const map = new TokenMapImpl();
    const urlOut = await sanitizeUrl('https://example.com/reset?email=priya.sharma.canary%40example.com', {
      origin: 'http://localhost/',
      tokenMap: map,
      node_id: 'n1',
      field: 'href',
    });
    expect(urlOut).toContain('PII_OTHER_1');
    expect(map.resolve('[PII_OTHER_1]')).toBe('priya.sharma.canary@example.com');
  });
});
