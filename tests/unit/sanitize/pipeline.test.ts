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

describe('sanitizeUnit: NER sees regex spans masked (§7.2, M12)', () => {
  it('passes masked text to NER and maps its spans back onto the original', async () => {
    const seen: string[] = [];
    // Tags "Priya" wherever it is in the text it receives.
    const ner = {
      async tag(texts: string[]) {
        seen.push(...texts);
        return texts.map((t) => {
          const i = t.indexOf('Priya');
          return i === -1 ? [] : [{ start: i, end: i + 5, label: 'NAME', confidence: 'high' as const }];
        });
      },
    };
    const out = await sanitizeUnit({ unit_id: 'u1', node_id: 'n1', field: 'text', text: 'Call +91 98765 43210 Priya' }, { ...ctx(), ner });
    expect(seen).toEqual(['Call [PII_PHONE] Priya']);
    expect(out).toBe('Call [PII_PHONE_1] [PII_NAME_1]'); // counters are per type
  });
});

describe('sanitizeUnit: known values keep their token (§7.6, M12)', () => {
  // Splits "First Last" into two NAME spans, as the real NER did on
  // httpbin's filled name field (the task had tokenized it as one).
  const splittingNer = {
    async tag(texts: string[]) {
      return texts.map((t) =>
        [...t.matchAll(/\b(Priya|Sharma)\b/g)].map((m) => ({ start: m.index, end: m.index + m[0].length, label: 'NAME', confidence: 'high' as const })),
      );
    },
  };
  const source = { node_id: '__task__', field: 'text', offset: 0 };

  it('reuses the token of a value already known on this origin instead of NER re-splitting it', async () => {
    const c = { ...ctx(), ner: splittingNer };
    const token = c.tokenMap.tokenize({ type: 'NAME', value: 'Priya Sharma', origin: c.origin, source });
    const out = await sanitizeUnit({ unit_id: 'u1', node_id: 'n5', field: 'value', text: 'Priya Sharma' }, c);
    expect(out).toBe(token);
  });

  it('still tokenizes a known value when NER misses it', async () => {
    const c = ctx(); // passthroughNer finds nothing
    const token = c.tokenMap.tokenize({ type: 'NAME', value: 'Priya Sharma', origin: c.origin, source });
    const out = await sanitizeUnit({ unit_id: 'u1', node_id: 'n9', field: 'text', text: 'Order for Priya Sharma is ready' }, c);
    expect(out).toBe(`Order for ${token} is ready`);
  });

  it('does not reuse a memoized result that predates the value becoming known', async () => {
    const c = ctx();
    const unit = { unit_id: 'u1', node_id: 'n9', field: 'text' as const, text: 'Order for Priya Sharma is ready' };
    expect(await sanitizeUnit(unit, c)).toBe(unit.text); // NER missed it; memoized
    const token = c.tokenMap.tokenize({ type: 'NAME', value: 'Priya Sharma', origin: c.origin, source });
    expect(await sanitizeUnit(unit, c)).toBe(`Order for ${token} is ready`);
  });

  it('keeps a known private email tokenized even where the heuristic would call it public', async () => {
    const c = { ...ctx(), origin: 'https://example.com' };
    const token = c.tokenMap.tokenize({ type: 'EMAIL', value: 'support@example.com', origin: c.origin, source });
    const out = await sanitizeUnit(
      {
        unit_id: 'u1',
        node_id: 'n1',
        field: 'text',
        text: 'email support@example.com for help',
        context: { in_landmark: false, near_contact_heading: false, in_contact_markup: true, in_ugc_block: false },
      },
      c,
    );
    expect(out).toBe(`email ${token} for help`);
  });
});
