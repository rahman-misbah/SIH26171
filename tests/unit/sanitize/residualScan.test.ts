// M12: residual scan over an *outgoing* observation (§18.1 on real sites,
// where there are no canaries). It re-runs the regex tier over every string
// that would leave the device and reports counts by type -- never the
// matched values, since on a real site those would be real people's data.

import { describe, expect, it } from 'vitest';
import { scanResidualPii } from '@/sanitize/residualScan';
import { loadCanaries } from '../../fixtures/loadCanaries';

const canaries = loadCanaries();

function canary(id: string): string {
  const found = canaries.find((c) => c.id === id);
  if (!found) throw new Error(`missing canary fixture: ${id}`);
  return found.value;
}

function observation(texts: string[], extra: Record<string, unknown> = {}): unknown {
  return {
    schema_version: '1',
    session_id: 's-1',
    step: 0,
    task: 'find the contact page',
    page: { url: 'https://shop.example.com/about', title: 'About us', viewport: { w: 1280, h: 720 }, scroll: { x: 0, y: 0 } },
    dom: texts.map((text, i) => ({ node_id: `n${i}`, tag: 'p', node_type: 'element', parent_id: null, content: { text } })),
    images: [],
    history: [],
    ...extra,
  };
}

const ORIGIN = 'https://shop.example.com';

describe('scanResidualPii', () => {
  it('reports nothing for a clean, tokenized observation', () => {
    const result = scanResidualPii(observation(['Call [PII_PHONE_1] or write to [PII_EMAIL_1].', 'Price: 1,299 INR']), ORIGIN);
    expect(result.hits).toEqual({});
    expect(result.scanned_strings).toBeGreaterThan(0);
  });

  it.each([
    ['aadhaar-valid', 'AADHAAR'],
    ['card-valid', 'CARD'],
    ['pan', 'PAN'],
    ['phone', 'PHONE'],
    ['email-personal', 'EMAIL'],
  ])('counts a planted %s as %s', (id, type) => {
    const result = scanResidualPii(observation([`leaked: ${canary(id)}`]), ORIGIN);
    expect(result.hits).toEqual({ [type]: 1 });
  });

  it('counts every hit, across nodes, history and the task string', () => {
    const obs = observation([`a ${canary('phone')}`, `b ${canary('phone')}`], {
      task: `email ${canary('email-personal')}`,
      history: [{ step: 0, thought: `saw ${canary('pan')}`, actions: [], results: [] }],
    });
    expect(scanResidualPii(obs, ORIGIN).hits).toEqual({ PHONE: 2, EMAIL: 1, PAN: 1 });
  });

  it('separates emails the §7.5 heuristic could have kept public (role or same-site)', () => {
    const result = scanResidualPii(observation(['support@shop.example.com', 'help@othersite.org', 'priya@gmail.com']), ORIGIN);
    expect(result.hits).toEqual({ EMAIL_LIKELY_PUBLIC: 2, EMAIL: 1 });
  });

  it('never scans image bytes', () => {
    const obs = observation([], { images: [{ img_id: 'i1', node_id: 'n1', mime: 'image/jpeg', data: { base64: canary('phone') } }] });
    expect(scanResidualPii(obs, ORIGIN).hits).toEqual({});
  });

  it('returns no matched text anywhere in its result', () => {
    const values = ['aadhaar-valid', 'card-valid', 'pan', 'phone', 'email-personal'].map(canary);
    const serialized = JSON.stringify(scanResidualPii(observation(values), ORIGIN));
    for (const value of values) expect(serialized).not.toContain(value);
  });
});
