// §6.6: the image cache -- IndexedDB in the compute host (extension origin).
// Web-standard IndexedDB, not an extension API, so not subject to the
// src/platform/ boundary (§4.2). Records are ImageCacheRecord (types.ts),
// which has no raw-bytes field by construction (§2.8, D9). Only exercised in
// a real browser (Vitest has no IndexedDB) -- see tests/e2e/images.spec.ts.

import { selectPrunable } from './cachePolicy';
import type { ImageCacheRecord, ImageCacheStore } from './types';

// Exported so the e2e suite can open the same database to inspect it.
export const IMAGE_CACHE_DB = 'edward-image-cache';
export const IMAGE_CACHE_STORE = 'images';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGE_CACHE_DB, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMAGE_CACHE_STORE)) {
        db.createObjectStore(IMAGE_CACHE_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB.open failed'));
  });
}

export class IdbImageCache implements ImageCacheStore {
  private dbPromise: Promise<IDBDatabase> | undefined;

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= openDb();
    return this.dbPromise;
  }

  async get(key: string): Promise<ImageCacheRecord | undefined> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const request = db.transaction(IMAGE_CACHE_STORE, 'readonly').objectStore(IMAGE_CACHE_STORE).get(key);
      request.onsuccess = () => resolve(request.result as ImageCacheRecord | undefined);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB get failed'));
    });
  }

  async put(record: ImageCacheRecord): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IMAGE_CACHE_STORE, 'readwrite');
      tx.objectStore(IMAGE_CACHE_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put failed'));
    });
  }

  // M12: deletes expired and over-cap records (cachePolicy.ts), returns how
  // many. One readwrite transaction: the cursor reads each record's
  // validated_at, then the chosen keys are deleted in the same transaction.
  async prune(now: number): Promise<number> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGE_CACHE_STORE, 'readwrite');
      const store = tx.objectStore(IMAGE_CACHE_STORE);
      const entries: { key: string; validated_at: number }[] = [];
      let deleted = 0;
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          const record = cursor.value as ImageCacheRecord;
          entries.push({ key: record.key, validated_at: record.validated_at });
          cursor.continue();
          return;
        }
        const keys = selectPrunable(entries, now);
        for (const key of keys) store.delete(key);
        deleted = keys.length;
      };
      tx.oncomplete = () => resolve(deleted);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB prune failed'));
    });
  }
}
