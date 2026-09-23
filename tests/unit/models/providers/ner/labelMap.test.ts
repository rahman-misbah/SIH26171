import { describe, expect, it } from 'vitest';
import { bucketConfidence, mapRawLabel } from '@/models/providers/ner/labelMap';

describe('mapRawLabel', () => {
  it('maps PERSON to NAME', () => {
    expect(mapRawLabel('PERSON')).toBe('NAME');
  });

  it('maps LOCATION to ADDRESS', () => {
    expect(mapRawLabel('LOCATION')).toBe('ADDRESS');
  });

  it('maps EMAIL_ADDRESS to EMAIL', () => {
    expect(mapRawLabel('EMAIL_ADDRESS')).toBe('EMAIL');
  });

  it('maps PHONE_NUMBER to PHONE', () => {
    expect(mapRawLabel('PHONE_NUMBER')).toBe('PHONE');
  });

  it('maps ORGANIZATION to null (not PII, dropped)', () => {
    expect(mapRawLabel('ORGANIZATION')).toBeNull();
  });

  it('maps DATE_TIME to OTHER, not DOB', () => {
    expect(mapRawLabel('DATE_TIME')).toBe('OTHER');
  });

  it('maps an unlisted-but-known category (e.g. US_SSN) to OTHER, still PII', () => {
    expect(mapRawLabel('US_SSN')).toBe('OTHER');
  });

  it('maps a completely unrecognized label to OTHER (fail-closed)', () => {
    expect(mapRawLabel('SOMETHING_NEW_FROM_A_FUTURE_CHECKPOINT')).toBe('OTHER');
  });
});

describe('bucketConfidence', () => {
  it('buckets >=0.85 as high', () => {
    expect(bucketConfidence(0.9)).toBe('high');
    expect(bucketConfidence(0.85)).toBe('high');
  });

  it('buckets [0.6, 0.85) as medium', () => {
    expect(bucketConfidence(0.6)).toBe('medium');
    expect(bucketConfidence(0.8)).toBe('medium');
  });

  it('buckets below 0.6 as low', () => {
    expect(bucketConfidence(0.1)).toBe('low');
    expect(bucketConfidence(0.59)).toBe('low');
  });
});
