import { describe, expect, it, vi } from 'vitest';

// No providers at all: every capability runs on its fail-closed fallback.
vi.mock('@/models/models.config', () => ({ modelProviders: { face: [], ocr: [], qr: [], ner: [] } }));

const { configureModelDeps } = await import('@/models/deps');
const { getActiveModelId, getModel } = await import('@/models/registry');
const { ReasonCodeError } = await import('@/logging');

configureModelDeps({
  compute: 'wasm',
  assetUrl: (p) => p,
  session_id: 's',
  logger: {
    record: vi.fn(),
    recordSession: vi.fn(),
    recordModelLoad: vi.fn(),
    flush: vi.fn(async () => {}),
    stop: vi.fn(),
    timed: async (_op, _meta, fn) => fn(),
  },
});

const blank = { data: {} as ImageData };

describe('registry fallbacks (§9.4: an item is never passed through because its detector failed)', () => {
  it('face detection rejects with detector_failed instead of returning "no faces"', async () => {
    const face = await getModel('face');
    await expect(face.detect(blank)).rejects.toSatisfy((e) => e instanceof ReasonCodeError && e.reason === 'detector_failed');
  });

  it('QR detection rejects with detector_failed', async () => {
    const qr = await getModel('qr');
    await expect(qr.detect(blank)).rejects.toSatisfy((e) => e instanceof ReasonCodeError && e.reason === 'detector_failed');
  });

  it('OCR rejects with detector_failed', async () => {
    const ocr = await getModel('ocr');
    await expect(ocr.read(blank)).rejects.toSatisfy((e) => e instanceof ReasonCodeError && e.reason === 'detector_failed');
  });

  it('NER degrades to an empty result (regex tier still runs upstream)', async () => {
    const ner = await getModel('ner');
    await expect(ner.tag(['a', 'b'])).resolves.toEqual([[], []]);
  });

  it('reports no active model id for a capability running on its fallback', async () => {
    await expect(getActiveModelId('face')).resolves.toBeUndefined();
  });
});
