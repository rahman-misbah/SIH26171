// §12.1: the privacy boundary object and the backend contract. The
// orchestrator and assembler depend only on AgentBackend and SanitizedObservation
// (CLAUDE.md boundaries) — nothing here may reference a vendor name (§12.5).

import type { Action, ActionResult, AgentResponse } from '@/agent/schema';
import type { SanitizedNode } from '@/dom/types';

export interface ObservationImage {
  img_id: string;
  node_id: string;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  data: Uint8Array;
}

export interface SanitizedObservation {
  schema_version: '1';
  session_id: string; // random per session, not linkable to the user
  step: number;
  task: string; // the user's task, sanitized through §7 like any other text
  page: {
    url: string;
    title: string;
    viewport: { w: number; h: number };
    scroll: { x: number; y: number };
  }; // sanitized
  dom: SanitizedNode[]; // §5 / §14
  images: ObservationImage[]; // already redacted and selected (§14)
  history: { step: number; thought: string; actions: Action[]; results: ActionResult[] }[]; // sanitized, no old images
  // M12 (§14.2): present when page content was left out for the budget;
  // nodes flagged `trimmed` show where. Absent means nothing was trimmed.
  truncated?: true;
}

export interface BackendCapabilities {
  maxImagesPerRequest: number;
  maxImageBytes: number;
  maxContextTokens: number;
}

export interface AgentBackend {
  readonly id: string; // e.g. 'llm:groq', 'http:custom'
  readonly capabilities: BackendCapabilities; // used by the assembler (§14), never vendor names
  init(): Promise<void>; // validate config (key/endpoint present, prompt loaded)
  decide(obs: SanitizedObservation, signal?: AbortSignal): Promise<AgentResponse>; // already validated
}
