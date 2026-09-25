import { describe, expect, it } from 'vitest';
import { isBackendCapabilities, toWireObservation } from '@/backend/http/wire';
import type { SanitizedObservation } from '@/backend/types';

function obs(data: Uint8Array): SanitizedObservation {
  return {
    schema_version: '1',
    session_id: 's1',
    step: 2,
    task: 'Fill in [PII_EMAIL_1]',
    page: { url: 'https://example.com/', title: 'x', viewport: { w: 1, h: 1 }, scroll: { x: 0, y: 0 } },
    dom: [],
    images: [{ img_id: 'i1', node_id: 'n1', mime: 'image/jpeg', data }],
    history: [],
  };
}

describe('toWireObservation (§12.3)', () => {
  it('base64-encodes image bytes and round-trips them exactly', () => {
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 31) % 256); // larger than one encoding chunk
    const wire = toWireObservation(obs(bytes));
    const decoded = Uint8Array.from(atob(wire.images[0]!.data), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });

  it('keeps every other field unchanged, including schema_version', () => {
    const wire = toWireObservation(obs(new Uint8Array([1, 2, 3])));
    expect(wire).toMatchObject({ schema_version: '1', session_id: 's1', step: 2, task: 'Fill in [PII_EMAIL_1]' });
    expect(wire.images[0]).toEqual({ img_id: 'i1', node_id: 'n1', mime: 'image/jpeg', data: 'AQID' });
  });
});

describe('isBackendCapabilities (GET /v1/capabilities)', () => {
  it('accepts non-negative image counts and positive byte/token limits', () => {
    expect(isBackendCapabilities({ maxImagesPerRequest: 0, maxImageBytes: 1, maxContextTokens: 1 })).toBe(true);
    expect(isBackendCapabilities({ maxImagesPerRequest: 3, maxImageBytes: 3_000_000, maxContextTokens: 131_072 })).toBe(true);
  });

  it('refuses missing, fractional, negative or non-numeric values', () => {
    expect(isBackendCapabilities({ maxImagesPerRequest: 3, maxImageBytes: 1 })).toBe(false);
    expect(isBackendCapabilities({ maxImagesPerRequest: 1.5, maxImageBytes: 1, maxContextTokens: 1 })).toBe(false);
    expect(isBackendCapabilities({ maxImagesPerRequest: -1, maxImageBytes: 1, maxContextTokens: 1 })).toBe(false);
    expect(isBackendCapabilities({ maxImagesPerRequest: 1, maxImageBytes: 0, maxContextTokens: 1 })).toBe(false);
    expect(isBackendCapabilities({ maxImagesPerRequest: '3', maxImageBytes: 1, maxContextTokens: 1 })).toBe(false);
    expect(isBackendCapabilities(null)).toBe(false);
  });
});
