// §12.5: "openaiCompatible.ts is both a usable client (provider
// 'openai-compatible', base URL from settings) and a helper that vendor
// files may build on; it never contains vendor-specific branches." The only
// place that calls `fetch()` for an LLM vendor (§12.6: no SDK, smaller
// bundle, no Node-isms) -- this file and the vendor files that configure it
// (groq.ts, openrouter.ts) are the only ones under src/backend/llm/clients/
// (SPEC §12.5, CLAUDE.md boundaries).

import type { ClientCapabilities, ImageContent, ModelClient, ModelRequest, ModelResponse, TextContent } from '../types';
import { ReasonCodeError } from '@/logging';

export interface OpenAiCompatibleConfig {
  id: string;
  baseUrl: string; // e.g. 'https://api.groq.com/openai/v1' -- no trailing slash
  apiKey: string;
  model: string;
  capabilities: ClientCapabilities;
  timeoutMs?: number; // per-attempt; §12.6 default 30s
  maxRetries?: number; // §12.6: "one retry with backoff on 429/5xx"
  // Extra top-level request fields a vendor file needs (e.g. OpenRouter's
  // routing block). Vendor-neutral: this file never inspects them. Spread
  // first, so they can never replace model, messages or response_format.
  extraBody?: Record<string, unknown>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 1;
const RETRY_DELAY_MS = 500;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000; // avoid a call-stack blowout on large images
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

type ChatContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

function toContentPart(item: TextContent | ImageContent): ChatContentPart {
  if (item.kind === 'text') return { type: 'text', text: item.text };
  return { type: 'image_url', image_url: { url: `data:${item.mime};base64,${toBase64(item.data)}` } };
}

function buildBody(config: OpenAiCompatibleConfig, req: ModelRequest): unknown {
  return {
    ...config.extraBody,
    model: config.model,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.items.map(toContentPart) },
    ],
    ...(req.wantJson ? { response_format: { type: 'json_object' } } : {}),
  };
}

// Ties a per-attempt timeout to the caller's own AbortSignal, so stopping a
// session (§13.2) aborts an in-flight request immediately regardless of the
// timeout. Written manually rather than relying on `AbortSignal.any` for
// clarity and because this file predates confirming that API's availability
// in every target browser's extension context.
function combinedSignal(callerSignal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onCallerAbort = () => controller.abort();
  callerSignal?.addEventListener('abort', onCallerAbort);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    },
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function attempt(config: OpenAiCompatibleConfig, req: ModelRequest, callerSignal: AbortSignal | undefined): Promise<ModelResponse> {
  const { signal, cleanup } = combinedSignal(callerSignal, config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody(config, req)),
      signal,
    });

    if (res.status === 429) throw new ReasonCodeError('backend_rate_limited');
    if (res.status >= 500) throw new ReasonCodeError('backend_error');
    if (!res.ok) throw new ReasonCodeError('backend_error'); // never surface the vendor's own error body (CLAUDE.md: no library error messages)

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new ReasonCodeError('backend_error');

    return {
      text,
      usage: data.usage ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens } : undefined,
    };
  } catch (error) {
    if (error instanceof ReasonCodeError) throw error;
    if (callerSignal?.aborted) throw error; // caller stopped the session -- propagate the abort as-is
    throw new ReasonCodeError('backend_error');
  } finally {
    cleanup();
  }
}

export function createOpenAiCompatibleClient(config: OpenAiCompatibleConfig): ModelClient {
  return {
    id: config.id,
    capabilities: config.capabilities,
    async generate(req: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
      const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
      let lastError: unknown;
      for (let i = 0; i <= maxRetries; i++) {
        try {
          return await attempt(config, req, signal);
        } catch (error) {
          lastError = error;
          const retryable = error instanceof ReasonCodeError && (error.reason === 'backend_rate_limited' || error.reason === 'backend_error');
          if (!retryable || i === maxRetries || signal?.aborted) throw error;
          await sleep(RETRY_DELAY_MS * (i + 1));
        }
      }
      throw lastError; // unreachable, satisfies the return type
    },
  };
}
