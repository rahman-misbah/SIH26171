// M12 (§9.4): what the settings page shows for each capability's model
// override. Plain data so the page never imports a provider (and with it a
// model library); tests/unit/models/catalog.test.ts keeps the ids in step
// with models.config.ts. "Automatic" means no override: the registry picks
// the first provider whose `requires` the device meets.

import type { Capability } from './capabilities';

export interface CatalogEntry {
  capability: Capability;
  label: string;
  automatic: string; // what "Automatic" picks, in words
  options: { id: string; label: string }[];
}

export const MODEL_CATALOG: CatalogEntry[] = [
  {
    capability: 'face',
    label: 'Face detection',
    automatic: 'Automatic (SCRFD + BlazeFace together)',
    options: [
      { id: 'face/scrfd+blazeface', label: 'SCRFD + BlazeFace (tier 2, small and close-up faces)' },
      { id: 'face/scrfd-2.5g', label: 'SCRFD-2.5G (tier 2, finds small faces, faster with a GPU)' },
      { id: 'face/blazeface-mediapipe', label: 'BlazeFace (tier 1, fastest, misses faces under ~128 px)' },
    ],
  },
  {
    capability: 'ocr',
    label: 'Text in images (OCR)',
    automatic: 'Automatic (Tesseract)',
    options: [{ id: 'ocr/tesseract-eng-lstm', label: 'Tesseract, English (tier 1)' }],
  },
  {
    capability: 'qr',
    label: 'QR codes and barcodes',
    automatic: 'Automatic (zxing)',
    options: [{ id: 'qr/zxing-wasm', label: 'zxing (tier 1)' }],
  },
  {
    capability: 'ner',
    label: 'Names and other PII in text (NER)',
    automatic: 'Automatic (BERT-small PII)',
    options: [{ id: 'ner/gravitee-bert-small-pii', label: 'BERT-small PII, gravitee-io (tier 1)' }],
  },
];
