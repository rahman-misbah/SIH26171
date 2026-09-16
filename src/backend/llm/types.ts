// §12.2: the generic LLM client layer (Python-prototype pattern, ported to
// TypeScript). Vendor-specific code lives only in src/backend/llm/clients/ (§12.5).

import type { BackendCapabilities } from '@/backend/types';

export type TextContent = { kind: 'text'; text: string };
export type ImageContent = { kind: 'image'; mime: 'image/jpeg' | 'image/png' | 'image/webp'; data: Uint8Array };

export interface ModelRequest {
  system: string;
  items: readonly (TextContent | ImageContent)[];
  wantJson: boolean;
}

export interface ModelResponse {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface ClientCapabilities extends BackendCapabilities {
  supportsJsonMode: boolean;
}

export interface ModelClient {
  readonly id: string;
  readonly capabilities: ClientCapabilities;
  generate(req: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>;
}
