// §11: metrics-only logging. Every field is an enum, number, boolean or opaque
// ID — no free-text field exists on LogRecord (§11.2).

import type { Capability } from '@/models/capabilities';
import type { DeviceProfile } from '@/hw/types';

export type OpName =
  | 'dom.phase_a'
  | 'dom.phase_b'
  | 'sanitize.regex'
  | 'sanitize.ner'
  | 'sanitize.memo_hit'
  | 'image.acquire'
  | 'image.face'
  | 'image.ocr'
  | 'image.qr'
  | 'image.redact'
  | 'image.cache_hit'
  | 'image.cache_miss'
  | 'image.revalidate'
  | 'model.load'
  | 'model.downgrade'
  | 'context.assemble'
  | 'backend.decide'
  | 'action.validate'
  | 'token.resolve'
  | 'action.execute'
  | 'agent.step';

export type Outcome = 'ok' | 'fail' | 'fail_closed' | 'skipped' | 'blocked';

// Every failure maps to one of these, never a raw library error string
// (CLAUDE.md: "New failure -> add a ReasonCode"; unknown ones fall back to 'unknown').
export type ReasonCode =
  | 'webgpu_device_lost'
  | 'cors_blocked'
  | 'low_confidence'
  | 'stale_node'
  | 'policy_url_token'
  | 'policy_cross_origin'
  | 'policy_form_origin'
  | 'policy_target'
  | 'policy_unknown_token'
  | 'backend_rate_limited'
  | 'backend_invalid_response'
  | 'backend_error'
  | 'unreadable'
  | 'detector_failed'
  | 'request_limit'
  | 'guard_triggered'
  | 'model_load_failed'
  | 'unknown';

export interface LogRecord {
  session_id: string;
  step?: number;
  op: OpName;
  t_start: number; // performance.timeOrigin + performance.now(), ms
  t_end: number;
  duration_ms: number;
  outcome: Outcome;
  reason?: ReasonCode;
  ref?: string; // opaque node_id / img_id / unit batch id only
  model_id?: string;
  tier?: 1 | 2;
  compute?: 'webgpu' | 'wasm'; // on-device execution target, not the reasoning backend
  counts?: Partial<
    Record<
      'units' | 'spans' | 'faces' | 'words' | 'codes' | 'images' | 'bytes' | 'tokens_in' | 'tokens_out',
      number
    >
  >;
}

export interface SessionRecord {
  session_id: string;
  started_at: number;
  device: DeviceProfile;
  models: { capability: Capability; model_id: string; tier: number; compute: string }[];
  backend_id: string;
  backend_model?: string;
}

// §9.4: one entry appended to a SessionRecord.models list once a provider
// actually loads. Registries are lazy singletons (§9.4), so this arrives
// well after the session's one-time recordSession() call -- see recordModelLoad.
export type ModelLoadEntry = SessionRecord['models'][number];

// Type-level contract for CLAUDE.md's `logger.timed(op, meta, fn)` — records
// start/end/outcome automatically, including on thrown errors. The ring
// buffer / IndexedDB sink / aggregator implementation arrives in M3 (§11.2).
export type LogMeta = Pick<LogRecord, 'session_id'> &
  Partial<Pick<LogRecord, 'step' | 'ref' | 'model_id' | 'tier' | 'compute' | 'counts' | 'reason'>>;

export interface Logger {
  timed<T>(op: OpName, meta: LogMeta, fn: () => Promise<T>): Promise<T>;
}
