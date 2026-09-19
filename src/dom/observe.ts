// The M5 entry point: Phase A -> Phase B -> chunked sanitize -> assemble
// (§5.2, §14). Runs in the content script; the compute host owns
// sanitization and assembly (§3 architecture -- the token map is
// compute-host-only, §7.6). `dom.phase_a`/`dom.phase_b` are timed here and
// forwarded to the host's logger, which has the only extension-origin
// IndexedDB (a content-script `indexedDB` would hit the *page's* origin).

import { buildContentUnits } from './contentUnits';
import { runPhaseA } from './skeleton';
import type { AssembleResult } from '@/agent/assemble';
import type { LogRecord } from '@/logging/schema';
import type { Transport } from '@/platform/types';
import type { ContentField, ContentUnit } from './types';

export interface ObserveOptions {
  session_id: string;
  step: number;
  task: string;
  origin: string;
}

const CHUNK_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function reportTiming(transport: Transport, record: LogRecord): void {
  transport.request('logRecord', record).catch(() => {
    // Best-effort: a lost timing record is not worth failing the observation over.
  });
}

// Page url/title and the task string reuse the exact same sanitize dispatch
// as DOM content (§7.8's href branch for the URL) via synthetic node ids,
// instead of a parallel code path.
const TASK_UNIT_ID = '__task__';
const URL_UNIT_ID = '__url__';
const TITLE_UNIT_ID = '__title__';

export async function observePage(transport: Transport, doc: Document, options: ObserveOptions): Promise<AssembleResult> {
  const { session_id, step, task, origin } = options;

  const phaseAStart = performance.timeOrigin + performance.now();
  const { skeleton, registry, textNodes } = await runPhaseA(doc);
  const phaseAEnd = performance.timeOrigin + performance.now();
  reportTiming(transport, {
    session_id,
    step,
    op: 'dom.phase_a',
    t_start: phaseAStart,
    t_end: phaseAEnd,
    duration_ms: phaseAEnd - phaseAStart,
    outcome: 'ok',
    counts: { units: skeleton.length },
  });

  const phaseBStart = performance.timeOrigin + performance.now();
  const units = buildContentUnits(skeleton, registry, textNodes);
  const pageUnits: ContentUnit[] = [
    { unit_id: TASK_UNIT_ID, node_id: '__task__', field: 'text' as ContentField, text: task },
    { unit_id: URL_UNIT_ID, node_id: '__page__', field: 'href' as ContentField, text: doc.location.href },
    { unit_id: TITLE_UNIT_ID, node_id: '__page__', field: 'text' as ContentField, text: doc.title },
  ];
  const allUnits = [...units, ...pageUnits];
  const phaseBEnd = performance.timeOrigin + performance.now();
  reportTiming(transport, {
    session_id,
    step,
    op: 'dom.phase_b',
    t_start: phaseBStart,
    t_end: phaseBEnd,
    duration_ms: phaseBEnd - phaseBStart,
    outcome: 'ok',
    counts: { units: allUnits.length },
  });

  const chunkResults = await Promise.all(
    chunk(allUnits, CHUNK_SIZE).map((batch) => transport.request('sanitizeChunk', { session_id, origin, units: batch })),
  );

  const sanitizedById = new Map<string, string>();
  for (const { results } of chunkResults) {
    for (const result of results) sanitizedById.set(result.unit_id, result.text);
  }

  const contentResults = units.map((unit) => ({
    node_id: unit.node_id,
    field: unit.field,
    text: sanitizedById.get(unit.unit_id) ?? '',
  }));

  return transport.request('assembleObservation', {
    session_id,
    step,
    task: sanitizedById.get(TASK_UNIT_ID) ?? '',
    page: {
      url: sanitizedById.get(URL_UNIT_ID) ?? '',
      title: sanitizedById.get(TITLE_UNIT_ID) ?? '',
      viewport: { w: doc.defaultView?.innerWidth ?? 0, h: doc.defaultView?.innerHeight ?? 0 },
      scroll: { x: doc.defaultView?.scrollX ?? 0, y: doc.defaultView?.scrollY ?? 0 },
    },
    skeleton,
    contentResults,
  });
}
