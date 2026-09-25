// Markdown for one `npm run bench:faces` run (scripts/faceRecall.ts), kept
// apart from the driver so it can be unit-tested. The run type is shared
// with tests/bench/faceRecall.spec.ts, which writes it.

export interface FaceRecallRun {
  provider: string; // the face model the settings asked for
  loaded: string | undefined; // the one the session record says loaded
  compute: string | undefined;
  found: { size: number; found: boolean }[]; // one per ground-truth face
  falsePositives: number; // detections that matched no ground-truth face
  faceMs: number | undefined; // median face.detect() time for the image, warm
}

function percent(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function renderFaceRecallSection(label: string, date: string, runs: FaceRecallRun[]): string {
  const sizes = [...new Set(runs.flatMap((r) => r.found.map((f) => f.size)))].sort((a, b) => b - a);
  const header = ['Provider', 'Loaded', 'Compute', 'Recall', ...sizes.map((s) => `${s} px`), 'False positives', 'Detect ms'];
  const rows = runs.map((r) => {
    const hits = r.found.filter((f) => f.found).length;
    const perSize = sizes.map((size) => {
      const ofSize = r.found.filter((f) => f.size === size);
      return `${ofSize.filter((f) => f.found).length}/${ofSize.length}`;
    });
    return [
      r.provider,
      r.loaded ?? 'none',
      r.compute ?? 'n/a',
      `${hits}/${r.found.length} (${percent(r.found.length ? hits / r.found.length : 0)})`,
      ...perSize,
      String(r.falsePositives),
      r.faceMs === undefined ? 'n/a' : String(Math.round(r.faceMs)),
    ];
  });
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [
    `## Face recall, ${label} — ${date}`,
    '',
    'tests/fixtures/assets/face-recall.png (1024x576): 18 synthetic faces, two per size. The detector alone is',
    'measured: a face is found when a detected box is centred inside it with IoU >= 0.2. False positives are',
    'detections that matched no face. Detect ms is the median of 3 warm calls. The model setting was the only change.',
    '',
    line(header),
    line(header.map(() => '---')),
    ...rows.map(line),
    '',
  ].join('\n');
}
