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
      // Mirrors IdbSink.putSession's upsert semantics (sessions store is
      // keyPath session_id, written with IDBObjectStore.put): a later write
      // for the same session_id replaces the earlier one in place.
      const i = sessions.findIndex((s) => s.session_id === session.session_id);
      if (i === -1) sessions.push(session);
      else sessions[i] = session;
    },
    async exportAll() {
      return { records, sessions };
    },
  };
}
