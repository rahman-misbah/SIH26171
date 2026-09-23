import { describe, expect, it } from 'vitest';
import { computeImgId, isInlineSource, pixelImgId, sha256Hex } from '@/image/imgId';

describe('isInlineSource (§6.3)', () => {
  it('flags data: and blob: URLs as inline (not cacheable)', () => {
    expect(isInlineSource('data:image/png;base64,AAAA')).toBe(true);
    expect(isInlineSource('blob:https://example.com/1234')).toBe(true);
    expect(isInlineSource('DATA:image/png;base64,AAAA')).toBe(true);
  });

  it('does not flag http(s) URLs', () => {
    expect(isInlineSource('https://example.com/a.png')).toBe(false);
    expect(isInlineSource('http://127.0.0.1:8080/a.png')).toBe(false);
  });
});

describe('computeImgId (§6.3: sha256(currentSrc|WxH), truncated)', () => {
  it('is stable for the same source and natural size', async () => {
    const a = await computeImgId('https://example.com/a.png', 200, 100);
    const b = await computeImgId('https://example.com/a.png', 200, 100);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it('changes when the source changes', async () => {
    expect(await computeImgId('https://example.com/a.png', 200, 100)).not.toBe(
      await computeImgId('https://example.com/b.png', 200, 100),
    );
  });

  it('changes when the natural size changes', async () => {
    expect(await computeImgId('https://example.com/a.png', 200, 100)).not.toBe(
      await computeImgId('https://example.com/a.png', 100, 200),
    );
  });

  it('matches the documented formula', async () => {
    const full = await sha256Hex(new TextEncoder().encode('https://example.com/a.png|200x100'));
    expect(await computeImgId('https://example.com/a.png', 200, 100)).toBe(full.slice(0, 32));
  });
});

describe('pixelImgId (§6.3: data:/blob: ids come from the pixel hash)', () => {
  it('derives a prefixed id from the raw pixel hash, distinct from any URL-derived id', () => {
    const raw = 'a'.repeat(64);
    expect(pixelImgId(raw)).toBe(`px-${'a'.repeat(32)}`);
  });
});

describe('sha256Hex', () => {
  it('hashes bytes to 64 lowercase hex characters', async () => {
    // sha256("abc")
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
