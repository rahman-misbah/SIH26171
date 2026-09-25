import { describe, expect, it } from 'vitest';
import { renderFaceRecallSection, type FaceRecallRun } from '../../../scripts/faceRecallTable.ts';

const run = (provider: string, foundSizes: number[], extra: Partial<FaceRecallRun> = {}): FaceRecallRun => ({
  provider,
  loaded: provider,
  compute: 'wasm',
  found: [64, 64, 20, 20].map((size, i) => ({ size, found: foundSizes.includes(i) })),
  falsePositives: 1,
  faceMs: 87.4,
  ...extra,
});

describe('renderFaceRecallSection', () => {
  const section = renderFaceRecallSection('dev laptop', '2026-09-25', [run('face/a', [0, 1, 2]), run('face/b', [0], { faceMs: undefined })]);

  it('titles the section so upsertSection can replace it on the next run', () => {
    expect(section.startsWith('## Face recall, dev laptop — 2026-09-25\n')).toBe(true);
  });

  it('reports overall recall and recall per face size, largest first', () => {
    expect(section).toContain('| Provider | Loaded | Compute | Recall | 64 px | 20 px | False positives | Detect ms |');
    expect(section).toContain('| face/a | face/a | wasm | 3/4 (75%) | 2/2 | 1/2 | 1 | 87 |');
  });

  it('prints n/a for a missing timing', () => {
    expect(section).toContain('| face/b | face/b | wasm | 1/4 (25%) | 1/2 | 0/2 | 1 | n/a |');
  });
});
