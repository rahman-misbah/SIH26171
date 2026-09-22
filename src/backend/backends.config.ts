// §12.4: maps backend ids to factories. `mock` was pulled forward from M6 to
// M4 (see docs/MILESTONES.md M2/M4 Log) for the canary e2e test. M6 adds the
// two real `llm:*` entries -- no rework of getBackend()/registry.ts itself.
// Adding a new LLM vendor (§12.5) needs only a new src/backend/llm/clients/
// file plus one more entry here; nothing here ever branches on a backend
// *kind* beyond 'llm'/'http'/'mock'.

import { getBackendDeps, tryGetBackendDeps } from './deps';
import { LlmAgentBackend } from './llm/backend';
import { createGroqClient, GROQ_CAPABILITIES } from './llm/clients/groq';
import { createOpenAiCompatibleClient } from './llm/clients/openaiCompatible';
import type { ClientCapabilities } from './llm/types';
import { MockAgentBackend } from './mock';
import { getBackendSettings } from './settings';
import type { AgentBackend } from './types';
import { ReasonCodeError } from '@/logging';

// A self-hosted server's true limits can't be known in advance without a
// capabilities-discovery step (that's what HttpAgentBackend's wire protocol
// is for, §12.3/M11) -- these are conservative prototype defaults for the
// raw openai-compatible ModelClient path.
const OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES: ClientCapabilities = {
  maxImagesPerRequest: 1,
  maxImageBytes: 5 * 1024 * 1024,
  maxContextTokens: 8192,
  supportsJsonMode: true,
};

const SYSTEM_PROMPT_PATH = '/assets/system_prompt.txt';

// §12.8: "loaded once at compute-host startup via platform.assetUrl" --
// memoized module-level so every LlmAgentBackend instance in this session
// shares one fetch, regardless of how many times getBackend('llm:*') is called.
let systemPromptPromise: Promise<string> | undefined;
function loadSystemPromptOnce(assetUrl: (path: string) => string): Promise<string> {
  systemPromptPromise ??= fetch(assetUrl(SYSTEM_PROMPT_PATH)).then((res) => {
    if (!res.ok) throw new ReasonCodeError('backend_error', 'system_prompt.txt failed to load');
    return res.text();
  });
  return systemPromptPromise;
}

export const backendFactories: Record<string, () => AgentBackend> = {
  mock: () => new MockAgentBackend(tryGetBackendDeps()?.settings),

  'llm:groq': () =>
    new LlmAgentBackend({
      id: 'llm:groq',
      capabilities: GROQ_CAPABILITIES,
      logger: getBackendDeps().logger,
      loadSystemPrompt: () => loadSystemPromptOnce(getBackendDeps().assetUrl),
      loadClient: async () => {
        const settings = await getBackendSettings(getBackendDeps().settings);
        const provider = settings.llm.groq;
        if (!provider?.apiKey) throw new ReasonCodeError('backend_error', 'groq api key not configured');
        return createGroqClient({ apiKey: provider.apiKey, model: provider.model });
      },
    }),

  'llm:openai-compatible': () =>
    new LlmAgentBackend({
      id: 'llm:openai-compatible',
      capabilities: OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES,
      logger: getBackendDeps().logger,
      loadSystemPrompt: () => loadSystemPromptOnce(getBackendDeps().assetUrl),
      loadClient: async () => {
        const settings = await getBackendSettings(getBackendDeps().settings);
        const provider = settings.llm['openai-compatible'];
        if (!provider?.apiKey || !provider.baseUrl || !provider.model) {
          throw new ReasonCodeError('backend_error', 'openai-compatible settings incomplete');
        }
        return createOpenAiCompatibleClient({
          id: 'openai-compatible',
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          model: provider.model,
          capabilities: OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES,
        });
      },
    }),
};
