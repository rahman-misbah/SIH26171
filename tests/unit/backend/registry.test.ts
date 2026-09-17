import { describe, expect, it } from 'vitest';
import { getBackend } from '@/backend';

describe('getBackend', () => {
  it('defaults to the mock backend', () => {
    const backend = getBackend();
    expect(backend.id).toBe('mock');
  });

  it('returns the same instance on repeated calls (lazy singleton)', () => {
    expect(getBackend('mock')).toBe(getBackend('mock'));
  });

  it('throws on an unknown backend id', () => {
    expect(() => getBackend('llm:groq')).toThrow('unknown backend id: llm:groq');
  });
});
