// §4.2: message shapes for `Transport`'s request/response calls and long-lived
// ports. Concrete entries (ping in M3, DOM chunks in M5, actions in M6, image
// acquisition in M8) are added here directly as each milestone needs them;
// this file is not meant to be built out ahead of need.

import type { AssembleResult } from '@/agent/assemble';
import type { ContentField, ContentUnit, SkeletonNode } from '@/dom/types';
import type { LogRecord } from '@/logging/schema';

export interface RequestMessageMap {
  // M3 infrastructure smoke test (§4.3.1 round trip) and, via the optional
  // `echo` payload, the §4.3.7 binary-transport-over-Chromium-messaging
  // benchmark -- no separate message type needed for either.
  ping: {
    request: { echo?: ArrayBuffer };
    response: { echo?: ArrayBuffer; respondedAt: number };
  };
  // §5.2/§7: one ~200-unit chunk, sanitized host-side (regex -> NER stub ->
  // decide -> tokenize, §7.1-7.6). The compute host owns the per-session
  // token map, so this can never run in the content script.
  sanitizeChunk: {
    request: { session_id: string; origin: string; units: ContentUnit[] };
    response: { results: { unit_id: string; text: string }[] };
  };
  // §14: merges sanitized content into the skeleton, builds the
  // SanitizedObservation, and runs the §14.5 final guard.
  assembleObservation: {
    request: {
      session_id: string;
      step: number;
      task: string; // already sanitized
      page: { url: string; title: string; viewport: { w: number; h: number }; scroll: { x: number; y: number } }; // already sanitized
      skeleton: SkeletonNode[];
      contentResults: { node_id: string; field: ContentField; text: string }[];
    };
    response: AssembleResult;
  };
  // Forwards an already-timed LogRecord from the content script (§11) --
  // it has no logger of its own; see RuntimeLogger.record()'s doc comment.
  logRecord: {
    request: LogRecord;
    response: Record<string, never>;
  };
}

// `Record<never, ...>` (rather than an empty interface) keeps this an
// indexable placeholder without tripping the no-empty-object-type lint rule.
// No port-based message exists yet -- §4.3.9's keep-alive ping is an M6
// concern (agent sessions don't exist until then).
export type PortMessageMap = Record<never, unknown>;

export interface MessageMap {
  request: RequestMessageMap;
  port: PortMessageMap;
}
