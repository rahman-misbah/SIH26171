// Shared loader for tests/fixtures/canaries.json, used by both the Vitest
// (tests/unit) and Playwright (tests/e2e) suites. Plain fs+JSON.parse rather
// than a JSON import, since tsconfig.json doesn't set resolveJsonModule and
// changing that repo-wide is out of scope for a fixture-loading helper.

import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface CanaryEntry {
  id: string;
  type: string;
  value: string;
  valid: boolean;
  note?: string;
}

export function loadCanaries(): CanaryEntry[] {
  const file = path.join(import.meta.dirname, 'canaries.json');
  return JSON.parse(readFileSync(file, 'utf-8')) as CanaryEntry[];
}
