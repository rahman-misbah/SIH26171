import { describe, expect, it } from 'vitest';
import { passthroughNer } from '@/sanitize/ner';
import { createSanitizeMemo } from '@/sanitize/memo';
import { sanitizeUnit, type PipelineContext } from '@/sanitize/pipeline';
import { TokenMapImpl } from '@/sanitize/tokenMap';

function ctx(): PipelineContext {
  return {
    origin: 'http://localhost/',
    tokenMap: new TokenMapImpl(),
    memo: createSanitizeMemo(),
    ner: passthroughNer,
    logger: { record: () => {} },
    session_id: 's1',
  };
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

  it('keeps a public support email as literal text, not tokenized', async () => {
    const out = await sanitizeUnit(
      {
        unit_id: 'u1',
        node_id: 'n1',
        field: 'text',
        text: 'email support@example.com for help',
        context: { in_landmark: false, near_contact_heading: false, in_contact_markup: true, in_ugc_block: false },
      },
      { ...ctx(), origin: 'https://example.com' },
    );
    expect(out).toBe('email support@example.com for help');
  });

  it('a repeated identical unit hits the memo on the second call (same PipelineContext)', async () => {
    const c = ctx();
    const unit = { unit_id: 'u1', node_id: 'n1', field: 'text' as const, text: 'reach me at priya@example.com' };
    const first = await sanitizeUnit(unit, c);
    const second = await sanitizeUnit(unit, c);
    expect(second).toBe(first);
  });
});
