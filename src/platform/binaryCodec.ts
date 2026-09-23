// §4.3.7: Chromium extension messaging is JSON-serialized (no ArrayBuffer),
// while Firefox/Safari use structured clone. Consumers always send/receive
// ArrayBuffer / Uint8Array, so this walks the payload and swaps them <->
// base64 around the wire on Chromium only. Uint8Array support was added in
// M9: ObservationImage.data (§12.1) is a Uint8Array, and without its own
// marker JSON would turn it into an `{"0":..,"1":..}` object.

const ARRAY_BUFFER_MARKER = '__edwardArrayBuffer';
const UINT8_MARKER = '__edwardUint8Array';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000; // avoid a call-stack blowout from String.fromCharCode(...bytes) on large buffers
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeBinary(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return { [ARRAY_BUFFER_MARKER]: bytesToBase64(new Uint8Array(value)) };
  if (value instanceof Uint8Array) return { [UINT8_MARKER]: bytesToBase64(value) };
  if (Array.isArray(value)) return value.map(encodeBinary);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encodeBinary(v)]));
  return value;
}

export function decodeBinary(value: unknown): unknown {
  if (isRecord(value) && typeof value[ARRAY_BUFFER_MARKER] === 'string') return base64ToBytes(value[ARRAY_BUFFER_MARKER]).buffer;
  if (isRecord(value) && typeof value[UINT8_MARKER] === 'string') return base64ToBytes(value[UINT8_MARKER]);
  if (Array.isArray(value)) return value.map(decodeBinary);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decodeBinary(v)]));
  return value;
}
