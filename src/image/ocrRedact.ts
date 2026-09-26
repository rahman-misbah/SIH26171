// §6.4.4 / §6.5: OCR words -> sanitization -> which word boxes to redact.
// OCR text runs the *same* §7 path as DOM text (regex -> NER -> decide ->
// tokenize), one line at a time: each line is a separate sequence, and all of
// an image's lines go to NER in one tag() call (micro-batching independent
// sequences, never one concatenated input -- CLAUDE.md). Only PII-flagged
// words are redacted, so non-PII text stays readable for the agent.
//
// Not memoized (§7.7): a repeat of the same image is already skipped whole
// by the image cache (§6.6). No context hints either -- an image has no
// landmark/heading/UGC structure, so the §7.5 email heuristic sees only the
// email itself and the page origin.

import { findKnownValues } from '@/sanitize/knownValues';
import { tagMasked } from '@/sanitize/maskRegex';
import { decidePii } from '@/sanitize/decide';
import { matchRegexSpans } from '@/sanitize/regex';
import type { TokenMapImpl } from '@/sanitize/tokenMap';
import type { Box, OcrEngine, PiiNer } from '@/models/capabilities';

export type OcrWord = Awaited<ReturnType<OcrEngine['read']>>[number];

export interface OcrLine {
  line: number;
  text: string;
  words: { word: OcrWord; start: number; end: number }[];
}

// Words are joined with one space per line, so a regex like the phone or
// Aadhaar pattern (which allows space separators) matches across words.
export function groupOcrLines(words: OcrWord[]): OcrLine[] {
  const byLine = new Map<number, OcrWord[]>();
  for (const w of words) {
    if (w.text.trim() === '') continue;
    const list = byLine.get(w.line);
    if (list) list.push(w);
    else byLine.set(w.line, [w]);
  }

  return [...byLine.entries()]
    .sort(([a], [b]) => a - b)
    .map(([line, lineWords]) => {
      let text = '';
      const placed = lineWords.map((word) => {
        if (text !== '') text += ' ';
        const start = text.length;
        text += word.text.trim();
        return { word, start, end: text.length };
      });
      return { line, text, words: placed };
    });
}

// §6.4.4: garbled OCR can hide an ID, so a `low`-confidence word that looks
// like part of an email (`@`) or a number (4+ digits anywhere in the word --
// counted in total, not only consecutively, since OCR noise can split a
// digit run with misread letters) is redacted even without a PII match.
const SUSPECT_MIN_DIGITS = 4;

export function isLowConfidenceSuspect(word: OcrWord): boolean {
  if (word.confidence !== 'low') return false;
  if (word.text.includes('@')) return true;
  return (word.text.match(/\d/g)?.length ?? 0) >= SUSPECT_MIN_DIGITS;
}

function unionBox(boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export interface OcrRedactionContext {
  ner: PiiNer;
  tokenMap: TokenMapImpl;
  origin: string;
  img_id: string;
}

export interface OcrRedactions {
  redacted: OcrWord[]; // each word at most once
  boxes: Box[]; // one per redacted word, in image pixels
}

// Rejects if NER rejects -- the pipeline then withholds the image (§6.4.6),
// rather than redacting only the regex hits.
export async function findOcrRedactions(words: OcrWord[], ctx: OcrRedactionContext): Promise<OcrRedactions> {
  const lines = groupOcrLines(words);
  if (lines.length === 0) return { redacted: [], boxes: [] };

  // M12: values already tokenized on this origin are found first, like DOM
  // text (sanitizeText.ts), masked for NER and exempt from the email check.
  const known = ctx.tokenMap.knownValues(ctx.origin);
  const knownPerLine = lines.map((l) => findKnownValues(l.text, known));
  const regexPerLine = lines.map((l, i) =>
    matchRegexSpans(l.text).filter((s) => !(knownPerLine[i] ?? []).some((k) => s.start < k.end && k.start < s.end)),
  );
  const nerResults = await tagMasked(
    ctx.ner,
    lines.map((l) => l.text),
    lines.map((_, i) => [...(knownPerLine[i] ?? []), ...(regexPerLine[i] ?? [])]),
  );
  const redacted = new Set<OcrWord>();

  lines.forEach((line, i) => {
    const decided = decidePii(line.text, regexPerLine[i] ?? [], nerResults[i] ?? [], {
      pageOrigin: ctx.origin,
      hints: undefined,
      isMailtoHref: false,
    });
    const spans = [...(knownPerLine[i] ?? []), ...decided];
    for (const span of spans) {
      const covered = line.words.filter((w) => w.start < span.end && span.start < w.end);
      if (covered.length === 0) continue;
      for (const w of covered) redacted.add(w.word);
      // §6.5: same token map as DOM text, so the same value on the page and
      // in an image shares one token. The token is not drawn on the image:
      // the image cache outlives the session, and a drawn token would mean
      // something else (or nothing) in a later one (decided in the M9 plan).
      ctx.tokenMap.tokenize({
        type: span.type,
        value: line.text.slice(span.start, span.end),
        origin: ctx.origin,
        source: { img_id: ctx.img_id, bbox: unionBox(covered.map((w) => w.word.box)) },
      });
    }
    for (const w of line.words) if (isLowConfidenceSuspect(w.word)) redacted.add(w.word);
  });

  const list = [...redacted];
  return { redacted: list, boxes: list.map((w) => w.box) };
}
