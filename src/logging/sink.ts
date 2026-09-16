// §11.2: storage boundary for the logger. Kept separate from `logger.ts` so
// the ring buffer / `timed()` logic can be unit-tested against an in-memory
// fake, while the real IndexedDB-backed implementation (`idbSink.ts`) is only
// exercised in a real browser (Vitest has no IndexedDB).

import type { LogRecord, SessionRecord } from './schema';

export interface LogSink {
  putRecords(records: LogRecord[]): Promise<void>;
  putSession(session: SessionRecord): Promise<void>;
  exportAll(): Promise<{ records: LogRecord[]; sessions: SessionRecord[] }>;
}
