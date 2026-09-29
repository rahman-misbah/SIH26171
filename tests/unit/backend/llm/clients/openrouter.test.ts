// §12.5/§12.6, M12 F11: the OpenRouter client is openaiCompatible.ts plus a
// fixed base URL, a default model and the privacy routing block. Network calls
// are stubbed -- this never hits OpenRouter.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenRouterClient, OPENROUTER_CAPABILITIES } from '@/backend/llm/clients/openrouter';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch() {
  const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(200, { choices: [{ message: { content: '{}' } }] }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentRequest(fetchMock: ReturnType<typeof stubFetch>): { url: unknown; headers: Record<string, string>; body: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls[0]!;
  return {
    url,
    headers: (init as RequestInit).headers as Record<string, string>,
    body: JSON.parse((init as RequestInit).body as string) as Record<string, unknown>,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createOpenRouterClient', () => {
  it('posts to the OpenRouter chat completions endpoint with the default model', async () => {
    const fetchMock = stubFetch();
    await createOpenRouterClient({ apiKey: 'k' }).generate({ system: 's', wantJson: true, items: [] });

    const { url, body } = sentRequest(fetchMock);
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(body.model).toBe('qwen/qwen3.8-27b');
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('respects a model override', async () => {
    const fetchMock = stubFetch();
    await createOpenRouterClient({ apiKey: 'k', model: 'google/gemini-3.8-flash' }).generate({ system: 's', wantJson: true, items: [] });
    expect(sentRequest(fetchMock).body.model).toBe('google/gemini-3.8-flash');
  });

  it('asks OpenRouter to route only to providers that do not store data and honour every parameter', async () => {
    const fetchMock = stubFetch();
    await createOpenRouterClient({ apiKey: 'k' }).generate({ system: 's', wantJson: true, items: [] });
    expect(sentRequest(fetchMock).body.provider).toEqual({ data_collection: 'deny', require_parameters: true });
  });

  it('sends no app-attribution headers, only auth and content type', async () => {
    const fetchMock = stubFetch();
    await createOpenRouterClient({ apiKey: 'k' }).generate({ system: 's', wantJson: true, items: [] });
    const { headers } = sentRequest(fetchMock);
    expect(Object.keys(headers).sort()).toEqual(['Authorization', 'Content-Type']);
    expect(headers.Authorization).toBe('Bearer k');
  });

  it('exposes its capabilities (8 images: every image fixture page fits one step)', () => {
    const client = createOpenRouterClient({ apiKey: 'k' });
    expect(client.id).toBe('openrouter');
    expect(client.capabilities).toEqual(OPENROUTER_CAPABILITIES);
    expect(OPENROUTER_CAPABILITIES).toEqual({
      maxImagesPerRequest: 8,
      maxImageBytes: 3 * 1024 * 1024,
      maxContextTokens: 131_072,
      supportsJsonMode: true,
    });
  });
});
