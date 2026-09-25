// M11 face-recall fixture (§18.4: "small-face and group photos for face
// recall. Record recall per provider"). Composes the two photo-realistic
// synthetic faces (face-3.png, face-4.png; the cartoon ones are left out)
// into one 1024x576 "group photo" at shrinking sizes, from 160 px down to
// 20 px. Because the faces are pasted in, every face's box is known exactly;
// they're written next to the PNG as ground truth. 1024 px wide so the
// outgoing image isn't rescaled (MAX_OUTPUT_SIDE, src/image/downscale.ts).
// All faces are synthetic -- never real people (§18).
//
// Run: node tests/fixtures/renderFaceRecall.ts

import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ASSETS = path.resolve(import.meta.dirname, 'assets');
const WIDTH = 1024;
const HEIGHT = 576;
const GAP = 24; // px between faces and from the edges, so no two ever touch
// Each size appears twice, once per synthetic face (the second mirrored).
const SIZES = [160, 128, 96, 72, 56, 40, 32, 24, 20];

export interface RecallFace {
  size: number;
  box: { x: number; y: number; w: number; h: number };
}

function layout(): RecallFace[] {
  const faces: RecallFace[] = [];
  let x = GAP;
  let y = GAP;
  let rowHeight = 0;
  for (const size of SIZES.flatMap((s) => [s, s])) {
    if (x + size + GAP > WIDTH) {
      x = GAP;
      y += rowHeight + GAP;
      rowHeight = 0;
    }
    faces.push({ size, box: { x, y, w: size, h: size } });
    x += size + GAP;
    rowHeight = Math.max(rowHeight, size);
  }
  if (y + rowHeight + GAP > HEIGHT) throw new Error('faces do not fit');
  return faces;
}

function dataUrl(file: string): string {
  return `data:image/png;base64,${readFileSync(path.join(ASSETS, file)).toString('base64')}`;
}

const faces = layout();
const sources = [dataUrl('face-3.png'), dataUrl('face-4.png')];
const imgs = faces
  .map((f, i) => {
    const mirror = i % 2 === 1 ? 'transform:scaleX(-1);' : '';
    return `<img src="${sources[i % 2]}" style="position:absolute;left:${f.box.x}px;top:${f.box.y}px;width:${f.size}px;height:${f.size}px;${mirror}">`;
  })
  .join('');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  // A soft grey gradient, so the background is neither flat nor face-like.
  await page.setContent(
    `<body style="margin:0;width:${WIDTH}px;height:${HEIGHT}px;background:linear-gradient(135deg,#8a9199,#c9ccc4);position:relative">${imgs}</body>`,
  );
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
  await page.screenshot({ path: path.join(ASSETS, 'face-recall.png') });
} finally {
  await browser.close();
}
await writeFile(path.join(ASSETS, 'face-recall.json'), `${JSON.stringify(faces, null, 2)}\n`);
console.log(`wrote face-recall.png + face-recall.json (${faces.length} faces)`);
