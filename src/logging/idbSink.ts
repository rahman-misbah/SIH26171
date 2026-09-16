// §11.2: the real storage backend for `LogSink`. Web-standard IndexedDB, not
// a browser-extension API, so this is not subject to the src/platform/
// boundary (§4.2). Only exercised in a real browser (Vitest has no
// IndexedDB) — see tests/e2e/ping.spec.ts.

import type { LogRecord, SessionRecord } from './schema';
import type { LogSink } from './sink';

const DB_NAME = 'edward-logs';
const DB_VERSION = 1;
const RECORDS_STORE = 'records';
const SESSIONS_STORE = 'sessions';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECORDS_STORE)) {
        db.createObjectStore(RECORDS_STORE, { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: 'session_id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB.open failed'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export class IdbSink implements LogSink {
  private dbPromise: Promise<IDBDatabase> | undefined;

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= openDb();
    return this.dbPromise;
  }

  async putRecords(records: LogRecord[]): Promise<void> {
    if (records.length === 0) return;
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(RECORDS_STORE, 'readwrite');
      const store = tx.objectStore(RECORDS_STORE);
      for (const record of records) store.add(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    });
  }

  async putSession(session: SessionRecord): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(SESSIONS_STORE, 'readwrite');
    await requestToPromise(tx.objectStore(SESSIONS_STORE).put(session));
  }

  async exportAll(): Promise<{ records: LogRecord[]; sessions: SessionRecord[] }> {
    const db = await this.db();
    const recordsTx = db.transaction(RECORDS_STORE, 'readonly');
    const sessionsTx = db.transaction(SESSIONS_STORE, 'readonly');
    const [records, sessions] = await Promise.all([
      requestToPromise(recordsTx.objectStore(RECORDS_STORE).getAll()) as Promise<LogRecord[]>,
      requestToPromise(sessionsTx.objectStore(SESSIONS_STORE).getAll()) as Promise<SessionRecord[]>,
    ]);
    return { records, sessions };
  }
}
