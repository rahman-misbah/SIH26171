// §12.6: Groq via the OpenAI-compatible chat completions format
// (`https://api.groq.com/openai/v1/chat/completions` -- confirmed against
// Groq's current docs at build time, not copied from the reference
// prototype's stale model id). Vendor-specific: base URL, model id,
// capabilities. No vendor branching lives here -- request/response handling
// is entirely openaiCompatible.ts's job (§12.5).

import { createOpenAiCompatibleClient } from './openaiCompatible';
import type { ClientCapabilities, ModelClient } from '../types';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

// qwen/qwen3.6-27b (the reference prototype's model, and SPEC §12.6's
// example) was decommissioned 2026-09-14; qwen/qwen3.8-27b is its direct
// successor -- same 27B multimodal architecture, same 131K context window.
// Verified against console.groq.com/docs/vision and /docs/deprecations.
const GROQ_DEFAULT_MODEL = 'qwen/qwen3.8-27b';

// console.groq.com/docs/vision (checked at build time): 131K context, max 3
// images per request (SPEC §12.6 said 5 -- corrected here to match current
// docs), 20MB max request size. maxImageBytes stays SPEC's conservative 3MB
// per-image budget, well under the 20MB whole-request cap.
export const GROQ_CAPABILITIES: ClientCapabilities = {
  maxImagesPerRequest: 3,
  maxImageBytes: 3 * 1024 * 1024,
  maxContextTokens: 131_072,
  supportsJsonMode: true,
};

export interface GroqClientConfig {
  apiKey: string;
  model?: string;
}

export function createGroqClient(config: GroqClientConfig): ModelClient {
  return createOpenAiCompatibleClient({
    id: 'groq',
    baseUrl: GROQ_BASE_URL,
    apiKey: config.apiKey,
    model: config.model ?? GROQ_DEFAULT_MODEL,
    capabilities: GROQ_CAPABILITIES,
  });
}
