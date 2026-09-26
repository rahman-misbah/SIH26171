// M12: §14.2's budget, applied before sanitization (user decision, M12 Log).
// Real pages have thousands of content units and NER runs on each, so an
// observation took 28-95 s; text past the budget is now never sanitized or
// sent, and the observation says so.

import { describe, expect, it } from 'vitest';
import { contentCharBudget, LATENCY_CHAR_CAP, pruneSkeleton, selectUnits, trimKey } from '@/dom/contentBudget';
import type { ContentField, ContentUnit, SkeletonNode } from '@/dom/types';

const VIEWPORT_H = 800;

function node(node_id: string, overrides: Partial<SkeletonNode> = {}): SkeletonNode {
  return {
    node_id,
    tag: 'p',
    node_type: 'element',
    parent_id: 'root',
    bbox: { x: 0, y: 100, w: 100, h: 20 },
    visible: true,
    in_viewport: true,
    pending_content: [],
    ...overrides,
  };
}

// A text node under `parent`, `y` px from the viewport's top.
function text(node_id: string, parent: string, y: number, overrides: Partial<SkeletonNode> = {}): SkeletonNode {
  return node(node_id, {
    tag: '#text',
    node_type: 'text',
    parent_id: parent,
    bbox: { x: 0, y, w: 100, h: 20 },
    in_viewport: y + 20 > 0 && y < VIEWPORT_H,
    pending_content: ['text'],
    ...overrides,
  });
}

let unitCounter = 0;
function unit(node_id: string, textValue: string, field: ContentField = 'text'): ContentUnit {
  unitCounter += 1;
  return { unit_id: `u${unitCounter}`, node_id, field, text: textValue };
}

const ids = (units: ContentUnit[]) => units.map((u) => u.node_id);
const BIG = { maxChars: 1_000_000, maxUnits: 1_000_000, viewportHeight: VIEWPORT_H };

describe('contentCharBudget (§14.2: <= 40% of maxContextTokens, less for latency)', () => {
  it('is 40% of the context at ~4 chars per token, capped for latency', () => {
    expect(contentCharBudget(1000)).toBe(1600);
    expect(contentCharBudget(8192)).toBe(Math.min(13_104, LATENCY_CHAR_CAP));
    expect(contentCharBudget(131_072)).toBe(LATENCY_CHAR_CAP);
  });

  it('is zero for a backend that reports no context (fails closed: nothing sent)', () => {
    expect(contentCharBudget(0)).toBe(0);
  });
});

describe('selectUnits', () => {
  const root = node('root', { tag: 'body', parent_id: null, bbox: { x: 0, y: 0, w: 100, h: 5000 } });

  it('keeps everything when it fits, and is not truncated', () => {
    const skeleton = [root, text('t1', 'root', 100), text('t2', 'root', 3000)];
    const units = [unit('t1', 'hello'), unit('t2', 'world')];
    expect(selectUnits(skeleton, units, BIG)).toEqual({ kept: units, trimmed: new Set() });
  });

  it('ranks in-viewport interactive, then in-viewport text, then off-viewport by distance, hidden last', () => {
    const link = node('a1', { tag: 'a', role: 'link', bbox: { x: 0, y: 3000, w: 50, h: 20 }, in_viewport: false, pending_content: ['href'] });
    const button = node('b1', { tag: 'button', pending_content: ['accessible_name'] });
    const skeleton = [
      root,
      text('far', 'root', 4000),
      text('hidden', 'root', 50, { visible: false }),
      text('near', 'root', 900),
      text('above', 'root', -300),
      text('inview', 'root', 100),
      link,
      text('linktext', 'a1', 3000),
      button,
    ];
    const units = [
      unit('far', 'far'),
      unit('hidden', 'hidden'),
      unit('near', 'near'),
      unit('above', 'above'),
      unit('inview', 'inview'),
      unit('a1', 'https://x.test/', 'href'),
      unit('linktext', 'link'),
      unit('b1', 'Go', 'accessible_name'),
    ];
    // Budget of 1 unit per step, grown one at a time, shows the order.
    const order: string[] = [];
    for (let n = 1; n <= units.length; n++) {
      const kept = ids(selectUnits(skeleton, units, { ...BIG, maxUnits: n }).kept);
      order.push(kept.find((id) => !order.includes(id)) ?? '?');
    }
    // Off the viewport, distance decides: near is 100 px below it, above
    // 280 px above it, the link and its text 2200 px below (interactive
    // first on a tie), far 3200 px below.
    expect(order).toEqual(['b1', 'inview', 'near', 'above', 'a1', 'linktext', 'far', 'hidden']);
  });

  it('keeps a node field whole: all its windows, or none', () => {
    const skeleton = [root, text('t1', 'root', 100), text('t2', 'root', 200)];
    const units = [unit('t1', 'aaaa'), unit('t2', 'bb'), unit('t2', 'bb')];
    const { kept, trimmed } = selectUnits(skeleton, units, { ...BIG, maxChars: 5 });
    expect(ids(kept)).toEqual(['t1']);
    expect([...trimmed]).toEqual([trimKey('t2', 'text')]);
  });

  it('stops at the first group that does not fit, so a later small one cannot jump the queue', () => {
    const skeleton = [root, text('t1', 'root', 100), text('t2', 'root', 900), text('t3', 'root', 2000)];
    const units = [unit('t1', 'aa'), unit('t2', 'b'.repeat(50)), unit('t3', 'c')];
    expect(ids(selectUnits(skeleton, units, { ...BIG, maxChars: 10 }).kept)).toEqual(['t1']);
  });

  it('enforces the unit cap', () => {
    const skeleton = [root, text('t1', 'root', 100), text('t2', 'root', 200)];
    const units = [unit('t1', 'a'), unit('t2', 'b')];
    expect(selectUnits(skeleton, units, { ...BIG, maxUnits: 1 }).trimmed.size).toBe(1);
  });

  it('keeps input order among the kept units (window order matters for merging)', () => {
    const skeleton = [root, text('t1', 'root', 900), text('t2', 'root', 100)];
    const units = [unit('t1', 'w1'), unit('t1', 'w2'), unit('t2', 'x')];
    expect(selectUnits(skeleton, units, BIG).kept).toEqual(units);
  });
});

describe('pruneSkeleton', () => {
  const root = node('root', { tag: 'body', parent_id: null, in_viewport: true });

  it('returns the skeleton untouched when nothing was trimmed', () => {
    const skeleton = [root, text('t1', 'root', 100)];
    expect(pruneSkeleton(skeleton, [unit('t1', 'x')], new Set())).toBe(skeleton);
  });

  it('drops trimmed and empty nodes, keeps what the agent needs, and flags where text was left out', () => {
    const section = node('sec', { tag: 'section', in_viewport: false, bbox: { x: 0, y: 3000, w: 100, h: 500 } });
    const skeleton = [
      root,
      text('kept', 'root', 100),
      section,
      text('gone', 'sec', 3000),
      node('emptyDiv', { tag: 'div', in_viewport: false }),
      node('input', { tag: 'input', role: 'textbox', pending_content: ['placeholder'] }),
      node('offLink', { tag: 'a', role: 'link', in_viewport: false, pending_content: ['href'] }),
      node('frame', { tag: 'iframe', in_viewport: false, marker: 'iframe_skipped' }),
      node('img', { tag: 'img', in_viewport: false, image: 'img' }),
      node('icon', { tag: 'img', in_viewport: false, image: 'img', image_omitted: 'too_small' }),
      node('inIcon', { tag: 'img', image: 'img', image_omitted: 'too_small' }),
      node('pw', { tag: 'input', in_viewport: false, secret: true }),
      node('partial', { tag: 'a', role: 'link', pending_content: ['accessible_name', 'href'] }),
    ];
    const kept = [unit('kept', 'x'), unit('partial', 'Home', 'accessible_name')];
    const trimmed = new Set([trimKey('gone', 'text'), trimKey('offLink', 'href'), trimKey('partial', 'href')]);
    const pruned = pruneSkeleton(skeleton, kept, trimmed);
    const byId = new Map(pruned.map((n) => [n.node_id, n]));

    // An off-viewport image still waiting for selection stays (it may be
    // sent); one already omitted there (Wikipedia: 476 tiny icons) goes, and
    // counts as trimmed content.
    expect([...byId.keys()]).toEqual(['root', 'kept', 'input', 'frame', 'img', 'inIcon', 'pw', 'partial']);
    // `gone`'s nearest kept ancestor is root (sec was dropped too); the
    // off-viewport link's text and the partial link's href were trimmed.
    expect(byId.get('root')?.trimmed).toBe(true);
    expect(byId.get('partial')?.trimmed).toBe(true);
    expect(byId.get('kept')?.trimmed).toBeUndefined();
    // Never mutates its input (the image pipeline shares these objects).
    expect(skeleton[0]?.trimmed).toBeUndefined();
  });

  it('flags where an off-viewport control with no content of its own was dropped', () => {
    const form = node('form', { tag: 'form', in_viewport: false, bbox: { x: 0, y: 3000, w: 100, h: 200 } });
    const skeleton = [
      root,
      text('kept', 'root', 100),
      form,
      text('label', 'form', 3000),
      node('check', { tag: 'input', parent_id: 'form', in_viewport: false }),
      node('farLink', { tag: 'a', role: 'link', in_viewport: false, pending_content: ['accessible_name'] }),
    ];
    // Only the checkbox is dropped without trimmed content of its own; the
    // off-viewport link keeps its text, so it isn't flagged.
    const kept = [unit('kept', 'x'), unit('label', 'Remember me'), unit('farLink', 'Help', 'accessible_name')];
    const pruned = pruneSkeleton(skeleton, kept, new Set([trimKey('other', 'text')]));
    const byId = new Map(pruned.map((n) => [n.node_id, n]));

    expect(byId.has('check')).toBe(false);
    expect(byId.get('form')?.trimmed).toBe(true);
    expect(byId.get('farLink')?.trimmed).toBeUndefined();
    expect(byId.get('root')?.trimmed).toBeUndefined();
  });

  it('keeps every ancestor of a kept node, so parent_id always resolves', () => {
    const skeleton = [
      root,
      node('wrap', { tag: 'div', in_viewport: false }),
      node('inner', { tag: 'div', parent_id: 'wrap', in_viewport: false }),
      text('t', 'inner', 3000),
      text('dropped', 'root', 4000),
    ];
    const pruned = pruneSkeleton(skeleton, [unit('t', 'x')], new Set([trimKey('dropped', 'text')]));
    expect(pruned.map((n) => n.node_id)).toEqual(['root', 'wrap', 'inner', 't']);
  });
});
