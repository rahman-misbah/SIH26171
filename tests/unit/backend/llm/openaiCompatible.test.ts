// §12.6: timeout/retry/error-mapping behaviour of the one real fetch()-based
// ModelClient. Network calls are stubbed -- this never hits a real vendor.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleClient } from '@/backend/llm/clients/openaiCompatible';
import { ReasonCodeError } from '@/logging';
import type { ClientCapabilities } from '@/backend/llm/types';

const CAPS: ClientCapabilities = { maxImagesPerRequest: 1, maxImageBytes: 1, maxContextTokens: 1000, supportsJsonMode: true };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createOpenAiCompatibleClient', () => {
  it('sends the system prompt, model, and text/image content parts as an OpenAI-style chat body', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(200, { choices: [{ message: { content: '{"ok":true}' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createOpenAiCompatibleClient({
      id: 'test',
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      model: 'test-model',
      capabilities: CAPS,
    });

    await client.generate({
      system: 'you are edward',
      wantJson: true,
      items: [
        { kind: 'text', text: 'hello' },
        { kind: 'image', mime: 'image/png', data: new Uint8Array([1, 2]) },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.test/v1/chat/completions');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer k');
    const body = JSON.parse((init as RequestInit).body as string) as {
      model: string;
      response_format?: unknown;
      messages: { role: string; content: unknown }[];
    };
    expect(body.model).toBe('test-model');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0]).toEqual({ role: 'system', content: 'you are edward' });
    expect(body.messages[1]?.content).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AQI=' } },
    ]);
  });

  it('merges extraBody fields without letting them override model, messages or response_format', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(200, { choices: [{ message: { content: '{}' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createOpenAiCompatibleClient({
      id: 't',
      baseUrl: 'https://x',
      apiKey: 'k',
      model: 'real-model',
      capabilities: CAPS,
      extraBody: { routing: { a: 1 }, model: 'injected', messages: [], response_format: { type: 'text' } },
    });
    await client.generate({ system: 's', wantJson: true, items: [{ kind: 'text', text: 'hello' }] });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.routing).toEqual({ a: 1 });
    expect(body.model).toBe('real-model');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ]);
  });

  it('returns the model text and usage on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(200, { choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
      ),
    );
    const client = createOpenAiCompatibleClient({ id: 't', baseUrl: 'https://x', apiKey: 'k', model: 'm', capabilities: CAPS });
    const res = await client.generate({ system: 's', wantJson: false, items: [] });
    expect(res).toEqual({ text: 'hi', usage: { inputTokens: 10, outputTokens: 5 } });
  });

  it('retries once on 429 then succeeds, without surfacing the vendor error body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: 'rate limited, vendor-specific message' }))
      .mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createOpenAiCompatibleClient({
      id: 't',
      baseUrl: 'https://x',
      apiKey: 'k',
      model: 'm',
      capabilities: CAPS,
      maxRetries: 1,
    });
    const res = await client.generate({ system: 's', wantJson: false, items: [] });
    expect(res.text).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws backend_rate_limited after exhausting retries on repeated 429s', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(429, { error: 'nope' })));
    const client = createOpenAiCompatibleClient({
      id: 't',
      baseUrl: 'https://x',
      apiKey: 'k',
      model: 'm',
      capabilities: CAPS,
      maxRetries: 1,
    });
    await expect(client.generate({ system: 's', wantJson: false, items: [] })).rejects.toMatchObject({
      reason: 'backend_rate_limited',
    });
  });

  it('maps a 500 to backend_error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, { error: 'server exploded, stack trace...' })));
    const client = createOpenAiCompatibleClient({
      id: 't',
      baseUrl: 'https://x',
      apiKey: 'k',
      model: 'm',
      capabilities: CAPS,
      maxRetries: 0,
    });
    await expect(client.generate({ system: 's', wantJson: false, items: [] })).rejects.toBeInstanceOf(ReasonCodeError);
  });

  it('propagates the caller AbortSignal without retrying', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        controller.abort();
        throw new DOMException('aborted', 'AbortError');
      }),
    );
    const client = createOpenAiCompatibleClient({ id: 't', baseUrl: 'https://x', apiKey: 'k', model: 'm', capabilities: CAPS });
    await expect(client.generate({ system: 's', wantJson: false, items: [] }, controller.signal)).rejects.toThrow();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});
