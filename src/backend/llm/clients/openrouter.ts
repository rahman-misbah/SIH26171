// §12.5, M12 F11: OpenRouter via the OpenAI-compatible chat completions format
// (`https://openrouter.ai/api/v1/chat/completions` -- checked against
// OpenRouter's docs and live /api/v1/models list on 2026-09-27). Vendor-specific:
// base URL, model id, capabilities and the routing block. Request/response
// handling is entirely openaiCompatible.ts's job (§12.5).
//
// OpenRouter's optional attribution headers (HTTP-Referer, X-Title) are
// deliberately not sent: they identify the app to a third party and add no
// function.

import { createOpenAiCompatibleClient } from './openaiCompatible';
import type { ClientCapabilities, ModelClient } from '../types';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// Same model as the Groq default (groq.ts), so the demo behaves the same on
// either backend. Listed on OpenRouter with image input and response_format.
const OPENROUTER_DEFAULT_MODEL = 'qwen/qwen3.8-27b';

// OpenRouter forwards each request to one of several upstream providers and
// publishes no global per-request image cap, so these are conservative and
// match Groq's limits for the same model: 3 images, SPEC's 3 MB per-image
// budget, 131K context (OpenRouter lists 1M, but not every upstream serves it).
export const OPENROUTER_CAPABILITIES: ClientCapabilities = {
  maxImagesPerRequest: 3,
  maxImageBytes: 3 * 1024 * 1024,
  maxContextTokens: 131_072,
  supportsJsonMode: true,
};

// Fail closed on routing: `data_collection: 'deny'` excludes upstream
// providers that may store or train on prompts (OpenRouter's default is
// 'allow'), and `require_parameters: true` excludes providers that would
// silently ignore response_format. If no provider qualifies, OpenRouter
// errors (-> backend_error) instead of routing somewhere looser.
const OPENROUTER_PRIVACY_ROUTING = {
  provider: { data_collection: 'deny', require_parameters: true },
};

export interface OpenRouterClientConfig {
  apiKey: string;
  model?: string;
}

export function createOpenRouterClient(config: OpenRouterClientConfig): ModelClient {
  return createOpenAiCompatibleClient({
    id: 'openrouter',
    baseUrl: OPENROUTER_BASE_URL,
    apiKey: config.apiKey,
    model: config.model ?? OPENROUTER_DEFAULT_MODEL,
    capabilities: OPENROUTER_CAPABILITIES,
    extraBody: OPENROUTER_PRIVACY_ROUTING,
  });
}
