// Reading the extension's metrics log (IndexedDB `edward-logs`, §11.2) from
// Playwright. The service worker shares the extension origin's IndexedDB, so
// it can read the log without opening offscreen.html in a tab -- which would
// bootstrap a *second* compute host (and, since M10, a second warm start).

import type { BrowserContext, Page, Worker } from '@playwright/test';
import type { LogRecord, SessionRecord } from '../../src/logging/schema';

type StoreName = 'records' | 'sessions';

// Runs inside the extension (page or service worker): plain IndexedDB.
// Everything it needs comes in as the argument (it's serialized over CDP).
function readInExtension(store: StoreName): Promise<unknown[]> {
  return new Promise<unknown[]>((resolve, reject) => {
    const openReq = indexedDB.open('edward-logs', 1);
    // Never create the database from here: an empty v1 database would stop
    // the logger's own upgrade from ever creating its stores.
    let notCreatedYet = false;
    openReq.onupgradeneeded = () => {
      notCreatedYet = true;
      openReq.transaction?.abort();
    };
    openReq.onsuccess = () => {
      const db = openReq.result;
      const getAllReq = db.transaction(store, 'readonly').objectStore(store).getAll();
      getAllReq.onsuccess = () => {
        resolve(getAllReq.result);
        db.close();
      };
      getAllReq.onerror = () => reject(getAllReq.error ?? new Error('getAll failed'));
    };
    openReq.onerror = () => {
      if (notCreatedYet) resolve([]);
      else reject(openReq.error ?? new Error('indexedDB.open failed'));
    };
  });
}

function readStore(target: Page | Worker, store: StoreName): Promise<unknown[]> {
  // Page.evaluate and Worker.evaluate have incompatible overload sets, so the
  // union can't be called directly.
  return 'goto' in target ? target.evaluate(readInExtension, store) : target.evaluate(readInExtension, store);
}

export async function readLogRecords(target: Page | Worker): Promise<LogRecord[]> {
  return (await readStore(target, 'records')) as LogRecord[];
}

// Chrome stops an idle MV3 service worker after ~30 s and Playwright can't
// wake it, so a failed read falls back to the settings page (an extension
// page with no compute-host side effects).
export async function readLogsFromServiceWorker(context: BrowserContext): Promise<LogRecord[]> {
  return (await readFromExtension(context, 'records')) as LogRecord[];
}

export async function readSessionsFromServiceWorker(context: BrowserContext): Promise<SessionRecord[]> {
  return (await readFromExtension(context, 'sessions')) as SessionRecord[];
}

async function readFromExtension(context: BrowserContext, store: StoreName): Promise<unknown[]> {
  const [worker] = context.serviceWorkers();
  if (worker) {
    try {
      return await readStore(worker, store);
    } catch {
      // fall through
    }
  }
  const extensionId = (worker ?? (await context.waitForEvent('serviceworker'))).url().split('/')[2] ?? '';
  const page = await context.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/settings.html`);
    return await readStore(page, store);
  } finally {
    await page.close();
  }
}

// §15 warm start (M10): resolves once every capability has a flushed
// `model.warmup` record, so latency tests measure warm, not startup,
// numbers. Logs flush every 5 s (§11.2), hence polling.
export async function waitForWarmStart(context: BrowserContext, timeoutMs = 120_000): Promise<LogRecord[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const warmups = (await readLogsFromServiceWorker(context)).filter((r) => r.op === 'model.warmup');
    if (warmups.length >= 4) return warmups;
    if (Date.now() > deadline) throw new Error(`warm start incomplete: ${warmups.length}/4 model.warmup records`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
