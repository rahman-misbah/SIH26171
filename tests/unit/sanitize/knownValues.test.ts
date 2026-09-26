// M12: values already tokenized this session are found again verbatim,
// before NER, so the same value always gets the same token (§7.6) and a later
// NER miss can't let a known value through.

import { describe, expect, it } from 'vitest';
import { findKnownValues, MIN_KNOWN_VALUE_LENGTH } from '@/sanitize/knownValues';

const name = (value: string) => ({ type: 'NAME' as const, value });

describe('findKnownValues', () => {
  it('finds a known value, case-insensitively, with its type', () => {
    expect(findKnownValues('Deliver to priya sharma today', [name('Priya Sharma')])).toEqual([{ type: 'NAME', start: 11, end: 23 }]);
  });

  it('finds every occurrence', () => {
    const spans = findKnownValues('Priya and Priya', [name('Priya')]);
    expect(spans.map((s) => s.start)).toEqual([0, 10]);
  });

  it('matches whole words only', () => {
    expect(findKnownValues('Priyanka and Supriya', [name('Priya')])).toEqual([]);
    expect(findKnownValues('Hi Priya.', [name('Priya')])).toEqual([{ type: 'NAME', start: 3, end: 8 }]);
  });

  it('prefers the longest value where known values overlap', () => {
    const spans = findKnownValues('Priya Sharma', [name('Priya'), name('Priya Sharma'), name('Sharma')]);
    expect(spans).toEqual([{ type: 'NAME', start: 0, end: 12 }]);
  });

  it('ignores values shorter than the minimum, so one short NER false positive does not spread', () => {
    const short = 'x'.repeat(MIN_KNOWN_VALUE_LENGTH - 1);
    expect(findKnownValues(`a ${short} b`, [name(short)])).toEqual([]);
  });

  it('does not match inside an existing token', () => {
    expect(findKnownValues('[PII_NAME_1]', [name('NAME')])).toEqual([]);
  });

  it('returns spans sorted by start', () => {
    const spans = findKnownValues('Sharma met Priya', [name('Priya'), name('Sharma')]);
    expect(spans.map((s) => s.start)).toEqual([0, 11]);
  });
});
