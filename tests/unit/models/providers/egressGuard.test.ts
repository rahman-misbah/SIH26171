import { describe, expect, it, vi } from 'vitest';
import { installEgressGuard, isAllowedWorkerUrl } from '@/models/providers/egressGuard';

const OWN = 'chrome-extension://abcdef';

describe('isAllowedWorkerUrl (§1: a model worker may only load its own bundled assets)', () => {
  it('allows the extension’s own origin, absolute or relative', () => {
    expect(isAllowedWorkerUrl(`${OWN}/models/face/blaze_face_short_range.tflite`, OWN)).toBe(true);
    expect(isAllowedWorkerUrl('/mediapipe/vision_wasm_module_internal.wasm', OWN)).toBe(true);
  });

  it('allows data: and blob: URLs, which never touch the network', () => {
    expect(isAllowedWorkerUrl('data:application/octet-stream;base64,AAAA', OWN)).toBe(true);
    expect(isAllowedWorkerUrl(`blob:${OWN}/1234`, OWN)).toBe(true);
  });

  it('blocks every other origin -- telemetry, CDNs, the page, localhost', () => {
    expect(isAllowedWorkerUrl('https://odml.pa.googleapis.com/v1/log', OWN)).toBe(false);
    expect(isAllowedWorkerUrl('https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/x.wasm', OWN)).toBe(false);
    expect(isAllowedWorkerUrl('http://127.0.0.1:8080/anything', OWN)).toBe(false);
    expect(isAllowedWorkerUrl('chrome-extension://someotherextension/x', OWN)).toBe(false);
  });

  it('blocks anything it cannot parse (fail-closed)', () => {
    expect(isAllowedWorkerUrl('http://[::1', OWN)).toBe(false);
  });
});

describe('installEgressGuard', () => {
  function fakeScope() {
    const realFetch = vi.fn(async () => new Response('ok'));
    class FakeXhr {
      open(...args: unknown[]) {
        void args;
      }
    }
    class FakeSocket {
      constructor(public url: string | URL) {}
    }
    const scope = {
      location: { origin: OWN },
      fetch: realFetch as unknown as typeof fetch,
      XMLHttpRequest: FakeXhr as unknown as typeof XMLHttpRequest,
      WebSocket: FakeSocket as unknown as typeof WebSocket,
      EventSource: FakeSocket as unknown as typeof EventSource,
    };
    return { scope, realFetch };
  }

  it('passes own-origin fetches through to the real fetch', async () => {
    const { scope, realFetch } = fakeScope();
    const onBlocked = vi.fn();
    installEgressGuard(scope, onBlocked);
    await scope.fetch(`${OWN}/models/x.onnx`);
    await scope.fetch(new URL('/ort/x.wasm', OWN));
    expect(realFetch).toHaveBeenCalledTimes(2);
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it('rejects a foreign fetch without ever calling the real fetch, and reports it', async () => {
    const { scope, realFetch } = fakeScope();
    const onBlocked = vi.fn();
    installEgressGuard(scope, onBlocked);
    await expect(scope.fetch('https://odml.pa.googleapis.com/v1/log', { method: 'POST' })).rejects.toThrow(TypeError);
    await expect(scope.fetch(new Request('https://example.com/'))).rejects.toThrow(TypeError);
    expect(realFetch).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledTimes(2);
  });

  it('blocks foreign XMLHttpRequest, WebSocket and EventSource targets', () => {
    const { scope } = fakeScope();
    const onBlocked = vi.fn();
    installEgressGuard(scope, onBlocked);
    const xhr = new scope.XMLHttpRequest();
    expect(() => xhr.open('POST', 'https://odml.pa.googleapis.com/v1/log')).toThrow(TypeError);
    expect(() => xhr.open('GET', `${OWN}/models/x`)).not.toThrow();
    expect(() => new scope.WebSocket('wss://example.com/')).toThrow(TypeError);
    expect(() => new scope.EventSource('https://example.com/')).toThrow(TypeError);
    expect(onBlocked).toHaveBeenCalledTimes(3);
  });
});
