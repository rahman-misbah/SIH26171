// M9 (M8 Noticed #1, decided in the M9 plan): the compute-host fetch
// fallback (§6.2.2) refuses page-supplied URLs pointing at private/intranet
// hosts. Written before the implementation.

import { describe, expect, it } from 'vitest';
import { isPrivateHostUrl } from '@/image/privateHost';

describe('isPrivateHostUrl', () => {
  it.each([
    'http://localhost/a.png',
    'http://LOCALHOST:8080/a.png',
    'http://app.localhost/a.png',
    'http://127.0.0.1/a.png',
    'http://127.9.9.9/a.png',
    'http://10.1.2.3/a.png',
    'http://172.16.0.1/a.png',
    'http://172.31.255.255/a.png',
    'http://192.168.1.10/a.png',
    'http://169.254.169.254/latest/meta-data',
    'http://100.64.0.1/a.png',
    'http://0.0.0.0/a.png',
    'http://2130706433/a.png', // 127.0.0.1 as a single integer -- URL parsing normalizes it
    'http://0x7f.1/a.png',
    'http://[::1]/a.png',
    'http://[fd12:3456::1]/a.png',
    'http://[fe80::1]/a.png',
    'http://[::ffff:192.168.0.1]/a.png',
    'http://printer.local/a.png',
    'http://wiki.internal/a.png',
    'http://nas.home.arpa/a.png',
    'http://intranet/a.png', // single-label name -> resolved via the local search domain
  ])('refuses %s', (url) => {
    expect(isPrivateHostUrl(url)).toBe(true);
  });

  it.each([
    'https://example.com/a.png',
    'https://cdn.example.co.in/x/y.jpg',
    'http://8.8.8.8/a.png',
    'http://172.32.0.1/a.png',
    'http://192.169.0.1/a.png',
    'http://[2606:4700::1111]/a.png',
    'data:image/png;base64,AAAA',
  ])('allows %s', (url) => {
    expect(isPrivateHostUrl(url)).toBe(false);
  });

  it('refuses an unparseable URL (fail-closed)', () => {
    expect(isPrivateHostUrl('http://[bad')).toBe(true);
  });
});
