import { describe, expect, it } from 'vitest';
import { parseHttpEndpoint } from '@/backend/http/endpoint';

describe('parseHttpEndpoint (§12.4: HTTPS only, plus http://localhost for development)', () => {
  it('accepts an HTTPS endpoint and drops a trailing slash', () => {
    expect(parseHttpEndpoint('https://agent.example.com/edward/')).toBe('https://agent.example.com/edward');
  });

  it('accepts plain http on localhost and 127.0.0.1 (the manifest\'s optional http hosts)', () => {
    expect(parseHttpEndpoint('http://localhost:8080')).toBe('http://localhost:8080');
    expect(parseHttpEndpoint('http://127.0.0.1:9000/')).toBe('http://127.0.0.1:9000');
  });

  it('refuses plain http anywhere else', () => {
    expect(parseHttpEndpoint('http://agent.example.com')).toBeUndefined();
    expect(parseHttpEndpoint('http://192.168.1.5:8080')).toBeUndefined();
    expect(parseHttpEndpoint('http://[::1]:9000')).toBeUndefined();
  });

  it('refuses other schemes, credentials, query strings, fragments and junk', () => {
    expect(parseHttpEndpoint('ftp://agent.example.com')).toBeUndefined();
    expect(parseHttpEndpoint('https://user:pw@agent.example.com')).toBeUndefined();
    expect(parseHttpEndpoint('https://agent.example.com/?k=v')).toBeUndefined();
    expect(parseHttpEndpoint('https://agent.example.com/#x')).toBeUndefined();
    expect(parseHttpEndpoint('not a url')).toBeUndefined();
    expect(parseHttpEndpoint('')).toBeUndefined();
  });
});
