// @vitest-environment happy-dom

import { beforeAll, describe, expect, it } from 'vitest';
import { buildContentUnits, mergeWindows, windowText } from '@/dom/contentUnits';
import { runPhaseA } from '@/dom/skeleton';
import { installFakeLayout } from './testLayout';

beforeAll(() => {
  installFakeLayout();
});

describe('windowText', () => {
  it('returns the whole text as one window when under the cap', () => {
    expect(windowText('short text')).toEqual(['short text']);
  });

  it('splits long text into overlapping windows', () => {
    const text = 'a'.repeat(4500);
    const windows = windowText(text);
    expect(windows.length).toBeGreaterThan(1);
    // Reassembling with the documented overlap should reproduce the original.
    expect(mergeWindows(windows)).toBe(text);
  });

  it('never mixes content across a window boundary (windows are substrings in order)', () => {
    const text = 'x'.repeat(2000) + 'y'.repeat(2000);
    const windows = windowText(text);
    expect(windows[0]?.startsWith('x'.repeat(100))).toBe(true);
    expect(mergeWindows(windows)).toBe(text);
  });
});

describe('buildContentUnits', () => {
  it('re-reads text-node content by node_id via the Phase A bridge', async () => {
    document.body.innerHTML = '<p>hello world</p>';
    const { skeleton, registry, textNodes } = await runPhaseA(document);
    const units = buildContentUnits(skeleton, registry, textNodes);
    expect(units).toEqual([
      expect.objectContaining({ field: 'text', text: 'hello world' }),
    ]);
  });

  it('re-reads a non-secret input value', async () => {
    document.body.innerHTML = '<input type="text" name="upi" value="priya.sharma@okaxis" />';
    const { skeleton, registry, textNodes } = await runPhaseA(document);
    const units = buildContentUnits(skeleton, registry, textNodes);
    expect(units.some((u) => u.field === 'value' && u.text === 'priya.sharma@okaxis')).toBe(true);
  });

  it('never emits a unit for a secret field (value was never queued in Phase A)', async () => {
    document.body.innerHTML = '<input type="password" name="password" value="Sup3rSecretCanary!" />';
    const { skeleton, registry, textNodes } = await runPhaseA(document);
    const units = buildContentUnits(skeleton, registry, textNodes);
    expect(units.some((u) => u.text.includes('Sup3rSecretCanary'))).toBe(false);
  });

  it('replaces a data: URL src with the inline-data placeholder, never the real bytes', async () => {
    document.body.innerHTML = '<img src="data:image/png;base64,AAAA" alt="pic" />';
    const { skeleton, registry, textNodes } = await runPhaseA(document);
    const units = buildContentUnits(skeleton, registry, textNodes);
    const srcUnit = units.find((u) => u.field === 'src');
    expect(srcUnit?.text).toBe('[inline-data]');
  });

  it('reads href content for a link', async () => {
    document.body.innerHTML = '<a href="/privacy">Privacy</a>';
    const { skeleton, registry, textNodes } = await runPhaseA(document);
    const units = buildContentUnits(skeleton, registry, textNodes);
    expect(units.some((u) => u.field === 'href' && u.text === '/privacy')).toBe(true);
  });
});
