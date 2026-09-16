import type { LogRecord, LogSink, SessionRecord } from '@/logging';

export function createFakeSink(): LogSink & { records: LogRecord[]; sessions: SessionRecord[] } {
  const records: LogRecord[] = [];
  const sessions: SessionRecord[] = [];
  return {
    records,
    sessions,
    async putRecords(batch) {
      records.push(...batch);
    },
    async putSession(session) {
      sessions.push(session);
    },
    async exportAll() {
      return { records, sessions };
    },
  };
}
