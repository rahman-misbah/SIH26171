// §7.2: NER "runs on each unit's text (after regex spans are masked out)".
// Added in M12 (M9 Noticed 4): unmasked, a raw phone number next to a word
// changed the model's reading of that word ("Call" in "Call Priya: +91 ..."
// came back as LOCATION). A regex span becomes `[PII_<TYPE>]`, the shape the
// model sees in already-tokenized text. NER spans are found in the masked
// text and mapped back to the original offsets; one that overlaps a
// placeholder is dropped, since the regex span already covers that text
// (decide.ts keeps the regex span on overlap anyway).

import type { PiiNer } from '@/models/capabilities';
import type { NerSpan } from './decide';
import type { RegexSpan } from './regex';

export interface MaskedText {
  masked: string;
  toOriginal: (span: { start: number; end: number }) => { start: number; end: number } | undefined;
}

interface Segment {
  maskedStart: number;
  maskedEnd: number;
  originalStart: number;
  placeholder: boolean;
}

export function maskRegexSpans(text: string, spans: RegexSpan[]): MaskedText {
  if (spans.length === 0) return { masked: text, toOriginal: (span) => ({ start: span.start, end: span.end }) };

  const segments: Segment[] = [];
  let masked = '';
  let cursor = 0;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    if (span.start > cursor) {
      segments.push({ maskedStart: masked.length, maskedEnd: masked.length + span.start - cursor, originalStart: cursor, placeholder: false });
      masked += text.slice(cursor, span.start);
    }
    const placeholder = `[PII_${span.type}]`;
    segments.push({ maskedStart: masked.length, maskedEnd: masked.length + placeholder.length, originalStart: span.start, placeholder: true });
    masked += placeholder;
    cursor = span.end;
  }
  if (cursor < text.length) {
    segments.push({ maskedStart: masked.length, maskedEnd: masked.length + text.length - cursor, originalStart: cursor, placeholder: false });
    masked += text.slice(cursor);
  }

  // A position inside a plain segment maps by that segment's offset.
  const toOriginalPos = (pos: number, isEnd: boolean): number | undefined => {
    const segment = segments.find((s) => (isEnd ? pos > s.maskedStart && pos <= s.maskedEnd : pos >= s.maskedStart && pos < s.maskedEnd));
    if (!segment || segment.placeholder) return undefined;
    return segment.originalStart + (pos - segment.maskedStart);
  };

  return {
    masked,
    toOriginal: (span) => {
      if (segments.some((s) => s.placeholder && span.start < s.maskedEnd && s.maskedStart < span.end)) return undefined;
      const start = toOriginalPos(span.start, false);
      const end = toOriginalPos(span.end, true);
      return start === undefined || end === undefined ? undefined : { start, end };
    },
  };
}

// Tags each text with NER after masking its regex spans, and returns the NER
// spans in the original texts' offsets. One tag() call for all texts, so
// micro-batching is unchanged (§7.2).
export async function tagMasked(
  ner: PiiNer,
  texts: string[],
  regexSpans: RegexSpan[][],
): Promise<NerSpan[][]> {
  const maskedTexts = texts.map((text, i) => maskRegexSpans(text, regexSpans[i] ?? []));
  const results = await ner.tag(maskedTexts.map((m) => m.masked));
  return maskedTexts.map((m, i) =>
    (results[i] ?? []).flatMap((span) => {
      const original = m.toOriginal(span);
      return original ? [{ ...span, ...original }] : [];
    }),
  );
}
