// §7.2: "Runs on each unit's text (after regex spans are masked out)."
// Missing until M12 (M9 Noticed 4): with a raw phone number in the text, the
// NER model tagged "Call" in "Call Priya: +91 98765 43210" as LOCATION; with
// the number masked it doesn't.

import { describe, expect, it } from 'vitest';
import { maskRegexSpans } from '@/sanitize/maskRegex';
import { matchRegexSpans } from '@/sanitize/regex';

describe('maskRegexSpans', () => {
  it('replaces each regex span with a typed placeholder', () => {
    const text = 'Call Priya: +91 98765 43210';
    expect(maskRegexSpans(text, matchRegexSpans(text)).masked).toBe('Call Priya: [PII_PHONE]');
  });

  it('returns the text unchanged when there is nothing to mask', () => {
    const { masked, toOriginal } = maskRegexSpans('Call Priya', []);
    expect(masked).toBe('Call Priya');
    expect(toOriginal({ start: 5, end: 10 })).toEqual({ start: 5, end: 10 });
  });

  it('maps a span found in the masked text back to the original offsets', () => {
    const text = 'Mail a@b.co or ring +91 98765 43210, ask for Rahul Verma.';
    const { masked, toOriginal } = maskRegexSpans(text, matchRegexSpans(text));
    const start = masked.indexOf('Rahul Verma');
    const back = toOriginal({ start, end: start + 'Rahul Verma'.length });
    expect(back).not.toBeUndefined();
    expect(text.slice(back!.start, back!.end)).toBe('Rahul Verma');
  });

  it('maps a span that starts right after a placeholder', () => {
    const text = '+91 98765 43210Priya';
    const { masked, toOriginal } = maskRegexSpans(text, matchRegexSpans(text));
    const start = masked.indexOf('Priya');
    expect(toOriginal({ start, end: start + 5 })).toEqual({ start: 15, end: 20 });
  });

  it('drops a span that touches a placeholder: the regex span already covers it', () => {
    const text = 'ring +91 98765 43210 now';
    const { masked, toOriginal } = maskRegexSpans(text, matchRegexSpans(text));
    const p = masked.indexOf('[PII_PHONE]');
    expect(toOriginal({ start: p, end: p + 3 })).toBeUndefined();
    expect(toOriginal({ start: 0, end: p + 2 })).toBeUndefined();
  });
});
