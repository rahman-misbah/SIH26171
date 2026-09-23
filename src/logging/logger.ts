// §11.2: the shared logger. `timed()` records start/end/outcome automatically,
// including on thrown errors, and never awaits the sink on the hot path — the
// ring buffer is flushed to the sink on a timer instead.

import type { Logger, LogMeta, LogRecord, ModelLoadEntry, OpName, ReasonCode, SessionRecord } from './schema';
import type { LogSink } from './sink';

const RING_BUFFER_CAP = 10_000;
const FLUSH_INTERVAL_MS = 5_000;

// New failure -> add a ReasonCode (CLAUDE.md) and throw this instead of a raw
// error, so `timed()` can log the enum instead of a library error message.
export class ReasonCodeError extends Error {
  constructor(
    public readonly reason: ReasonCode,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = 'ReasonCodeError';
  }
}

function toReasonCode(error: unknown): ReasonCode {
  return error instanceof ReasonCodeError ? error.reason : 'unknown';
}

export interface RuntimeLogger extends Logger {
  recordSession(session: SessionRecord): void;
  // §9.4: getModel() is a lazy singleton, so a model typically loads well
  // after recordSession()'s one-time call -- this appends one entry to that
  // session's `models` list and re-queues the whole record so the next
  // flush's sink.putSession() upserts it (IdbSink keys the sessions store by
  // session_id and uses IDBObjectStore.put, which overwrites in place).
  // No-op if session_id is unknown (nothing to update).
  recordModelLoad(session_id: string, entry: ModelLoadEntry): void;
  // Ingests an already-timed record from another context (e.g. the content
  // script, which has no logger of its own -- its `indexedDB` would hit the
  // *page's* origin, not the extension's -- so it forwards a finished
  // LogRecord for the compute host to persist instead of computing it here).
  record(record: LogRecord): void;
  flush(): Promise<void>;
  stop(): void;
}

export function createLogger(sink: LogSink): RuntimeLogger {
  let ring: LogRecord[] = [];
  let pendingSessions: SessionRecord[] = [];
  const sessions = new Map<string, SessionRecord>();

  function push(record: LogRecord): void {
    ring.push(record);
    if (ring.length > RING_BUFFER_CAP) ring.splice(0, ring.length - RING_BUFFER_CAP);
  }

  async function flush(): Promise<void> {
    const batch = ring;
    ring = [];
    if (batch.length > 0) await sink.putRecords(batch);

    const sessions = pendingSessions;
    pendingSessions = [];
    await Promise.all(sessions.map((session) => sink.putSession(session)));
  }

  const timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  // Don't let the periodic flush keep a Node-hosted context alive by itself.
  if (typeof timer === 'object' && 'unref' in timer) timer.unref();

  return {
    async timed<T>(op: OpName, meta: LogMeta, fn: () => Promise<T>): Promise<T> {
      const t_start = performance.timeOrigin + performance.now();
      try {
        const result = await fn();
        const t_end = performance.timeOrigin + performance.now();
        push({ ...meta, op, t_start, t_end, duration_ms: t_end - t_start, outcome: 'ok' });
        return result;
      } catch (error) {
        const t_end = performance.timeOrigin + performance.now();
        push({
          ...meta,
          op,
          t_start,
          t_end,
          duration_ms: t_end - t_start,
          outcome: 'fail',
          reason: toReasonCode(error),
        });
        throw error;
      }
    },
    recordSession(session: SessionRecord): void {
      sessions.set(session.session_id, session);
      pendingSessions.push(session);
    },
    recordModelLoad(session_id: string, entry: ModelLoadEntry): void {
      const session = sessions.get(session_id);
      if (!session) return;
      const updated = { ...session, models: [...session.models, entry] };
      sessions.set(session_id, updated);
      pendingSessions.push(updated);
    },
    record(record: LogRecord): void {
      push(record);
    },
    flush,
    stop(): void {
      clearInterval(timer);
    },
  };
}
