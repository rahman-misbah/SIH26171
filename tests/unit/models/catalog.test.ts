// M12: the settings page lists every on-device model from this catalogue
// (plain data, so the page never loads a provider or a model library). It
// must list exactly the registry's providers, in its order.

import { describe, expect, it } from 'vitest';
import { MODEL_CATALOG } from '@/models/catalog';
import { modelProviders } from '@/models/models.config';
import type { Capability } from '@/models/capabilities';

const CAPABILITIES: Capability[] = ['face', 'ocr', 'qr', 'ner'];

describe('MODEL_CATALOG', () => {
  it('has one entry per capability, in a fixed order', () => {
    expect(MODEL_CATALOG.map((c) => c.capability)).toEqual(CAPABILITIES);
  });

  it('lists exactly the registered providers of each capability, in preference order', () => {
    for (const entry of MODEL_CATALOG) {
      expect(entry.options.map((o) => o.id), entry.capability).toEqual(modelProviders[entry.capability].map((p) => p.id));
    }
  });

  it('gives every capability and option a label', () => {
    for (const entry of MODEL_CATALOG) {
      expect(entry.label).not.toBe('');
      expect(entry.automatic).not.toBe('');
      for (const option of entry.options) expect(option.label).not.toBe('');
    }
  });
});
