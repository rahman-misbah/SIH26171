// §6.4.4 / §6.5: OCR words -> per-line text -> the §7 regex/NER/decide path
// -> which word boxes get redacted, plus the low-confidence rule and the
// {img_id, bbox} token source. Written before the implementation.

import { describe, expect, it, vi } from 'vitest';
import { findOcrRedactions, groupOcrLines, isLowConfidenceSuspect, type OcrWord } from '@/image/ocrRedact';
import type { PiiNer } from '@/models/capabilities';
import { TokenMapImpl } from '@/sanitize/tokenMap';

function word(text: string, line: number, x: number, confidence: OcrWord['confidence'] = 'high'): OcrWord {
  return { text, line, confidence, box: { x, y: line * 20, w: text.length * 8, h: 16 } };
}

const noNer: PiiNer = { tag: async (texts) => texts.map(() => []) };

function ctx(overrides: { ner?: PiiNer; tokenMap?: TokenMapImpl } = {}) {
  return {
    ner: overrides.ner ?? noNer,
    tokenMap: overrides.tokenMap ?? new TokenMapImpl(),
    origin: 'https://shop.example',
    img_id: 'img1',
  };
}

describe('groupOcrLines', () => {
  it('joins each line with single spaces and records every word\'s char range', () => {
    const lines = groupOcrLines([word('Call', 0, 0), word('Priya:', 0, 40), word('Order', 1, 0)]);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.text).toBe('Call Priya:');
    expect(lines[0]!.words.map((w) => [w.start, w.end])).toEqual([
      [0, 4],
      [5, 11],
    ]);
    expect(lines[1]!.text).toBe('Order');
  });

  it('orders lines by line index and keeps reading order within a line', () => {
    const lines = groupOcrLines([word('b', 1, 0), word('a1', 0, 0), word('a2', 0, 30)]);
    expect(lines.map((l) => l.text)).toEqual(['a1 a2', 'b']);
  });

  it('skips empty/whitespace-only words', () => {
    const lines = groupOcrLines([word('  ', 0, 0), word('x', 0, 10)]);
    expect(lines[0]!.text).toBe('x');
  });
});

describe('isLowConfidenceSuspect (§6.4.4)', () => {
  it('flags a low word containing @', () => {
    expect(isLowConfidenceSuspect(word('pr1ya@ex', 0, 0, 'low'))).toBe(true);
  });
  it('flags a low word with 4+ digits, counted across the word (not only consecutive)', () => {
    expect(isLowConfidenceSuspect(word('98a7b6c5', 0, 0, 'low'))).toBe(true);
  });
  it('does not flag a low word with 3 digits and no @', () => {
    expect(isLowConfidenceSuspect(word('abc123', 0, 0, 'low'))).toBe(false);
  });
  it('never flags a medium/high word by this rule', () => {
    expect(isLowConfidenceSuspect(word('98765', 0, 0, 'medium'))).toBe(false);
    expect(isLowConfidenceSuspect(word('a@b', 0, 0, 'high'))).toBe(false);
  });
});

describe('findOcrRedactions', () => {
  it('redacts every word overlapping a regex PII span and leaves non-PII words visible', async () => {
    const words = [word('Call', 0, 0), word('+91', 0, 40), word('98765', 0, 80), word('43210', 0, 130), word('today', 0, 180)];
    const result = await findOcrRedactions(words, ctx());
    expect(result.redacted.map((w) => w.text)).toEqual(['+91', '98765', '43210']);
    expect(result.boxes).toHaveLength(3);
  });

  it('keeps an all-non-PII image fully visible', async () => {
    const result = await findOcrRedactions([word('Order', 0, 0), word('summary', 0, 50)], ctx());
    expect(result.boxes).toEqual([]);
  });

  it('redacts NER spans, batching all lines in one tag() call (one text per line, never concatenated)', async () => {
    const tag = vi.fn(async (texts: string[]) =>
      texts.map((t) => (t.startsWith('Call') ? [{ start: 5, end: 10, label: 'NAME', confidence: 'low' as const }] : [])),
    );
    const words = [word('Call', 0, 0), word('Priya', 0, 40), word('Order', 1, 0)];
    const result = await findOcrRedactions(words, ctx({ ner: { tag } }));
    expect(tag).toHaveBeenCalledTimes(1);
    expect(tag.mock.calls[0]![0]).toEqual(['Call Priya', 'Order']);
    expect(result.redacted.map((w) => w.text)).toEqual(['Priya']);
  });

  it('tokenizes OCR PII into the token map with an {img_id, bbox} source (§6.5)', async () => {
    const tokenMap = new TokenMapImpl();
    await findOcrRedactions([word('ABCPE1234F', 0, 0)], ctx({ tokenMap }));
    const entry = tokenMap.entryForToken('[PII_PAN_1]');
    expect(entry?.value).toBe('ABCPE1234F');
    expect(entry?.sources).toEqual([{ img_id: 'img1', bbox: { x: 0, y: 0, w: 80, h: 16 } }]);
  });

  it('a multi-word span\'s token bbox is the union of its words', async () => {
    const tokenMap = new TokenMapImpl();
    await findOcrRedactions([word('2345', 0, 0), word('6789', 0, 40), word('0124', 0, 80)], ctx({ tokenMap }));
    const entry = tokenMap.entryForToken('[PII_AADHAAR_1]');
    expect(entry?.sources).toEqual([{ img_id: 'img1', bbox: { x: 0, y: 0, w: 112, h: 16 } }]);
  });

  it('redacts a value already tokenized on this origin even when NER misses it, reusing its token (M12)', async () => {
    const tokenMap = new TokenMapImpl();
    const c = ctx({ tokenMap });
    const token = tokenMap.tokenize({ type: 'NAME', value: 'Priya Sharma', origin: c.origin, source: { node_id: '__task__', field: 'text', offset: 0 } });
    const result = await findOcrRedactions([word('Priya', 0, 0), word('Sharma', 0, 50), word('ordered', 0, 110)], c);
    expect(result.redacted.map((w) => w.text)).toEqual(['Priya', 'Sharma']);
    expect(tokenMap.entryForToken(token)?.sources).toHaveLength(2);
  });

  it('applies the low-confidence rule even with no PII match', async () => {
    const result = await findOcrRedactions([word('Ref', 0, 0), word('9x8y7z65', 0, 40, 'low')], ctx());
    expect(result.redacted.map((w) => w.text)).toEqual(['9x8y7z65']);
  });

  it('does not double-count a word flagged by both a span and the low-confidence rule', async () => {
    const result = await findOcrRedactions([word('ABCPE1234F', 0, 0, 'low')], ctx());
    expect(result.boxes).toHaveLength(1);
  });

  it('rejects when NER rejects (the caller withholds the image, §6.4.6)', async () => {
    const ner: PiiNer = { tag: async () => Promise.reject(new Error('boom')) };
    await expect(findOcrRedactions([word('x', 0, 0)], ctx({ ner }))).rejects.toThrow();
  });

  it('returns nothing (and calls no model) when OCR found no words', async () => {
    const tag = vi.fn(async (texts: string[]) => texts.map(() => []));
    const result = await findOcrRedactions([], ctx({ ner: { tag } }));
    expect(result.boxes).toEqual([]);
    expect(tag).not.toHaveBeenCalled();
  });
});
