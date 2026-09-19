// §7.4 decision rule, exercised generically against synthetic regex/NER spans
// (the M5 pass-through NER stub always returns [], so this proves the merge
// logic decide.ts will still need once M7 plugs in a real PiiNer).

import { describe, expect, it } from 'vitest';
import { decidePii } from '@/sanitize/decide';

describe('decidePii', () => {
  it('keeps regex spans as-is', () => {
    const spans = decidePii([{ type: 'EMAIL', start: 0, end: 5 }], []);
    expect(spans).toEqual([{ type: 'EMAIL', start: 0, end: 5 }]);
  });

  it('adds a non-overlapping NER span, typed OTHER (no label map until M7)', () => {
    const spans = decidePii([], [{ start: 10, end: 20, label: 'PERSON', confidence: 'high' }]);
    expect(spans).toEqual([{ type: 'OTHER', start: 10, end: 20 }]);
  });

  it('any confidence bucket counts as PII (fail-closed, §7.3)', () => {
    const spans = decidePii([], [{ start: 0, end: 4, label: 'PERSON', confidence: 'low' }]);
    expect(spans).toHaveLength(1);
  });

  it('drops a NER span that overlaps an already-claimed regex span', () => {
    const spans = decidePii(
      [{ type: 'EMAIL', start: 0, end: 10 }],
      [{ start: 5, end: 15, label: 'MISC', confidence: 'high' }],
    );
    expect(spans).toEqual([{ type: 'EMAIL', start: 0, end: 10 }]);
  });

  it('sorts merged spans by start position', () => {
    const spans = decidePii(
      [{ type: 'EMAIL', start: 20, end: 25 }],
      [{ start: 0, end: 5, label: 'PERSON', confidence: 'high' }],
    );
    expect(spans.map((s) => s.start)).toEqual([0, 20]);
  });
});
