// §4.2: message shapes for `Transport`'s request/response calls, long-lived
// ports, and tab pushes (`sendToTab`/`onTabPush`). Concrete entries (ping in
// M3, DOM chunks in M5, agent-loop/tab-push messages in M6, image
// acquisition in M8, OCR/QR/selection fields in M9) are added here directly as each milestone needs them;
// this file is not meant to be built out ahead of need.

import type { AssembleResult } from '@/agent/assemble';
import type { DecideStepResult } from '@/agent/loop';
import type { ActionResult } from '@/agent/schema';
import type { ContentField, ContentUnit, SkeletonNode } from '@/dom/types';
import type { ImageRef, LookupResult, ProcessResult } from '@/image/pipeline';
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
  // SanitizedObservation, and runs the §14.5 final guard. Used by M5's
  // observe-only path (the ping e2e test); real agent-loop steps use
  // agentDecide instead, which does this and more in one round trip.
  assembleObservation: {
    request: {
      session_id: string;
      step: number;
      task: string; // already sanitized
      page: { url: string; title: string; viewport: { w: number; h: number }; scroll: { x: number; y: number } }; // already sanitized
      skeleton: SkeletonNode[];
      contentResults: { node_id: string; field: ContentField; text: string }[];
      // §14.3: whose capabilities select this step's images (M9).
      backend_id: string;
    };
    response: AssembleResult;
  };
  // §13.2: assemble -> backend.decide() -> §13.4 policy check -> token
  // resolution, one round trip per agent-loop step. Same request shape as
  // assembleObservation plus the page origin (policy rules 2-4) and which
  // backend to use.
  agentDecide: {
    request: {
      session_id: string;
      step: number;
      task: string;
      page: { url: string; title: string; viewport: { w: number; h: number }; scroll: { x: number; y: number } };
      skeleton: SkeletonNode[];
      contentResults: { node_id: string; field: ContentField; text: string }[];
      origin: string;
      backend_id: string;
    };
    response: DecideStepResult;
  };
  // Reports what the content script actually executed for the resolved
  // action prefix agentDecide last returned, so the host can build this
  // step's History entry (§13.2/§14.1).
  agentReportResults: {
    request: { session_id: string; results: ActionResult[] };
    response: Record<string, never>;
  };
  // Aborts the session's in-flight backend call and clears its token map (§7.6).
  agentStop: {
    request: { session_id: string };
    response: Record<string, never>;
  };
  // §6.6/§15: one per observation, no pixels -- computes each image's
  // img_id host-side and answers from the cache where it can, so a cache
  // hit never pays for a canvas read or a pixel transfer.
  // M9: also starts the step's sendable-image set, and returns the send
  // budget (the backend's maxImagesPerRequest, §14.3) so the content script
  // stops processing once that many images are ready (§6.7: "the assembler
  // waits only for images it will actually send").
  imageLookup: {
    request: { session_id: string; origin: string; backend_id: string; images: ImageRef[] };
    response: { results: LookupResult[]; send_budget: number };
  };
  // §6.2/§6.4: one image the lookup couldn't answer. `pixels` is a PNG of
  // the content script's canvas read (§4.3.7 -- lossless, and much smaller
  // than raw RGBA over Chromium's base64 messaging); absent when the canvas
  // was tainted or the image never loaded, in which case the compute host
  // tries its own fetch (§6.2.2) before withholding it as unreadable.
  imageProcess: {
    request: { session_id: string; origin: string; image: ImageRef; pixels?: ArrayBuffer };
    response: ProcessResult;
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
// No port-based message exists yet -- §4.3.9's keep-alive ping is a nice-to
// -have hardening step, not required for the M6 vertical slice itself.
export type PortMessageMap = Record<never, unknown>;

export interface MessageMap {
  request: RequestMessageMap;
  port: PortMessageMap;
}

// §13.2/§4.3.5: popup -> content-script pushes (Platform.sendToTab /
// onTabPush), a separate channel from Transport.request -- these originate
// from the popup (or, for 'stopTask', the content script's own overlay), not
// from the compute host, and have no response.
export type TabPushMessage = { type: 'startTask'; task: string } | { type: 'stopTask' };

export function isTabPushMessage(value: unknown): value is TabPushMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  const type = (value as { type: unknown }).type;
  return type === 'startTask' || type === 'stopTask';
}
