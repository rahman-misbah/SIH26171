// §4.3.7 Chromium JSON transport: binary fields survive a JSON round trip.

import { describe, expect, it } from 'vitest';
import { decodeBinary, encodeBinary } from '@/platform/binaryCodec';

const roundTrip = (value: unknown) => decodeBinary(JSON.parse(JSON.stringify(encodeBinary(value))));

describe('binaryCodec', () => {
  it('round-trips an ArrayBuffer as an ArrayBuffer', () => {
    const out = roundTrip({ pixels: new Uint8Array([1, 2, 255]).buffer }) as { pixels: ArrayBuffer };
    expect(out.pixels).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(out.pixels)]).toEqual([1, 2, 255]);
  });

  it('round-trips a nested Uint8Array (ObservationImage.data) as a Uint8Array', () => {
    const out = roundTrip({ observation: { images: [{ img_id: 'a', data: new Uint8Array([9, 0, 7]) }] } }) as {
      observation: { images: { img_id: string; data: Uint8Array }[] };
    };
    const data = out.observation.images[0]!.data;
    expect(data).toBeInstanceOf(Uint8Array);
    expect([...data]).toEqual([9, 0, 7]);
  });

  it('encodes only the viewed bytes of a Uint8Array subarray', () => {
    const view = new Uint8Array([1, 2, 3, 4]).subarray(1, 3);
    expect([...(roundTrip(view) as Uint8Array)]).toEqual([2, 3]);
  });

  it('leaves plain values untouched', () => {
    expect(roundTrip({ a: 1, b: ['x', null], c: { d: true } })).toEqual({ a: 1, b: ['x', null], c: { d: true } });
  });
});
