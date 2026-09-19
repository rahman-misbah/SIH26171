import { describe, expect, it } from 'vitest';
import { sanitizeUnit } from '@/sanitize/pipeline';
import { TokenMapImpl } from '@/sanitize/tokenMap';

function ctx() {
  return { origin: 'http://localhost/', tokenMap: new TokenMapImpl() };
}

describe('sanitizeUnit', () => {
  it('routes href fields through URL sanitization', async () => {
    const out = await sanitizeUnit(
      { unit_id: 'u1', node_id: 'n1', field: 'href', text: 'https://example.com/reset?token=abc123secret' },
      ctx(),
    );
    expect(out).not.toContain('abc123secret');
    expect(out).toContain('PII_OTHER_1');
  });

  it('routes src fields through URL sanitization', async () => {
    const out = await sanitizeUnit({ unit_id: 'u1', node_id: 'n1', field: 'src', text: '/avatar.png' }, ctx());
    expect(out).toBe('/avatar.png');
  });

  it('routes text fields through the plain text pipeline', async () => {
    const out = await sanitizeUnit(
      { unit_id: 'u1', node_id: 'n1', field: 'text', text: 'reach me at priya.sharma.canary@example.com' },
      ctx(),
    );
    expect(out).not.toContain('priya.sharma.canary');
    expect(out).toContain('PII_EMAIL_1');
  });

  it('leaves non-PII text untouched', async () => {
    const out = await sanitizeUnit({ unit_id: 'u1', node_id: 'n1', field: 'text', text: 'hello world' }, ctx());
    expect(out).toBe('hello world');
  });
});
