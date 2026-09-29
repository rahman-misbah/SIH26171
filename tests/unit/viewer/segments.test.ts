import { describe, expect, it } from 'vitest';
import { countPlaceholders, splitPlaceholders } from '@/viewer/segments';

describe('splitPlaceholders (viewer demo tooling)', () => {
  it('splits text around tokens and [SECRET]', () => {
    expect(splitPlaceholders('Call [PII_PHONE_1] or mail [PII_EMAIL_2]. PIN [SECRET]')).toEqual([
      { kind: 'text', text: 'Call ' },
      { kind: 'token', text: '[PII_PHONE_1]', type: 'PHONE' },
      { kind: 'text', text: ' or mail ' },
      { kind: 'token', text: '[PII_EMAIL_2]', type: 'EMAIL' },
      { kind: 'text', text: '. PIN ' },
      { kind: 'secret', text: '[SECRET]' },
    ]);
  });

  it('handles multi-word types and text with no placeholders', () => {
    expect(splitPlaceholders('[PII_AADHAAR_NUMBER_3]')).toEqual([{ kind: 'token', text: '[PII_AADHAAR_NUMBER_3]', type: 'AADHAAR_NUMBER' }]);
    expect(splitPlaceholders('plain')).toEqual([{ kind: 'text', text: 'plain' }]);
    expect(splitPlaceholders('')).toEqual([]);
  });

  it('leaves look-alikes alone', () => {
    expect(splitPlaceholders('[pii_name_1] [PII_NAME] [PII_NAME_x]')).toEqual([{ kind: 'text', text: '[pii_name_1] [PII_NAME] [PII_NAME_x]' }]);
  });
});

describe('countPlaceholders', () => {
  it('counts distinct tokens per type and every secret field', () => {
    expect(countPlaceholders(['[PII_NAME_1] and [PII_NAME_1]', '[PII_NAME_2]', '[PII_EMAIL_1]', '[SECRET]', '[SECRET]'])).toEqual({
      NAME: 2,
      EMAIL: 1,
      SECRET: 2,
    });
    expect(countPlaceholders(['nothing here'])).toEqual({});
  });
});
