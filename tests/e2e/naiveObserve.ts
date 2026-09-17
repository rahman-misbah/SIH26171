// Test-only stand-in for M5's real DOM -> sanitize -> assembler pipeline
// (src/dom, src/sanitize, and the assembler — none of which exist yet).
// Walks a live page and dumps its raw text/attribute/URL content into a
// SanitizedObservation-shaped object with *zero* redaction, purely so the
// canary leak e2e test (canary.spec.ts) has something to run against and can
// fail for the right reason — raw content leaking straight through — instead
// of not existing. Never imported from src/. Delete once M5 lands a real
// assembler (docs/MILESTONES.md M4 Log).

import type { Page } from '@playwright/test';
import type { ObservationImage, SanitizedObservation } from '../../src/backend/types';
import type { SanitizedNode } from '../../src/dom/types';

interface RawNode {
  tag: string;
  text: string;
  href?: string;
  src?: string;
  placeholder?: string;
  value?: string;
  bbox: { x: number; y: number; w: number; h: number };
  visible: boolean;
}

async function extractRawNodes(page: Page): Promise<RawNode[]> {
  return page.evaluate((): RawNode[] => {
    function walk(doc: Document, out: RawNode[]): void {
      for (const el of Array.from(doc.querySelectorAll('*'))) {
        const rect = el.getBoundingClientRect();
        const text = Array.from(el.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? '')
          .join(' ')
          .trim();
        const value = 'value' in el ? (el as HTMLInputElement).value : undefined;
        out.push({
          tag: el.tagName.toLowerCase(),
          text,
          href: el.getAttribute('href') ?? undefined,
          src: el.getAttribute('src') ?? undefined,
          placeholder: el.getAttribute('placeholder') ?? undefined,
          value: value || undefined,
          bbox: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          },
          visible: rect.width > 0 && rect.height > 0,
        });
        // No exclusion mechanism exists yet (that's M5's job, §5.1's
        // `iframe_skipped` marker) — the naive shim honestly walks into
        // same-origin iframes too, so their canaries leak just like everything else.
        if (el.tagName === 'IFRAME') {
          const frameDoc = (el as HTMLIFrameElement).contentDocument;
          if (frameDoc) walk(frameDoc, out);
        }
      }
    }
    const out: RawNode[] = [];
    walk(document, out);
    return out;
  });
}

export async function naiveObserve(page: Page, sessionId: string, step: number): Promise<SanitizedObservation> {
  const rawNodes = await extractRawNodes(page);

  const dom: SanitizedNode[] = rawNodes.map((node, index) => ({
    node_id: `n${index}`,
    tag: node.tag,
    node_type: 'element',
    parent_id: null,
    bbox: node.bbox,
    visible: node.visible,
    in_viewport: node.visible,
    content: {
      ...(node.text ? { text: node.text } : {}),
      ...(node.href ? { href: node.href } : {}),
      ...(node.src ? { src: node.src } : {}),
      ...(node.placeholder ? { placeholder: node.placeholder } : {}),
      ...(node.value ? { value: node.value } : {}),
    },
  }));

  const images: ObservationImage[] = [];
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };

  return {
    schema_version: '1',
    session_id: sessionId,
    step,
    task: 'fixture walkthrough (no canaries in the task string itself)',
    page: {
      url: page.url(),
      title: await page.title(),
      viewport: { w: viewport.width, h: viewport.height },
      scroll: { x: 0, y: 0 },
    },
    dom,
    images,
    history: [],
  };
}
