// §11.2: "Export as JSON/CSV from the settings page." The settings-page UI
// itself is an M6 deliverable; this is the export logic it will call into.

import type { LogRecord } from './schema';
import type { LogSink } from './sink';

const CSV_COLUMNS = [
  'session_id',
  'step',
  'op',
  't_start',
  't_end',
  'duration_ms',
  'outcome',
  'reason',
  'ref',
  'model_id',
  'tier',
  'compute',
] as const satisfies readonly (keyof LogRecord)[];

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(records: LogRecord[]): string {
  const rows = records.map((record) => CSV_COLUMNS.map((column) => csvCell(record[column])).join(','));
  return [CSV_COLUMNS.join(','), ...rows].join('\n');
}

export async function exportLogs(sink: LogSink, format: 'json' | 'csv'): Promise<string> {
  const { records, sessions } = await sink.exportAll();
  return format === 'json' ? JSON.stringify({ records, sessions }, null, 2) : toCsv(records);
}
