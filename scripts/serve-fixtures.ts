// Serves tests/fixtures/ on fixed ports for the manual browser checklist
// (docs/BROWSER_CHECKLIST.md, SPEC §18.5): `npm run serve-fixtures`.
// Two origins, like tests/e2e/images.spec.ts: the second one sends no CORS
// headers, so its images exercise the §6.2.2 host fetch fallback.
// Plain Node script (Node 24 strips the types itself), like fetch-models.ts.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from '../tests/e2e/staticServer.ts';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../tests/fixtures');
const MAIN_PORT = 8123;
const CROSS_ORIGIN_PORT = 8124;
// Mapped to 127.0.0.1 by the browser (Firefox: network.dns.localDomains;
// Chromium: --host-resolver-rules), because the fallback refuses 127.0.0.1.
const PUBLIC_NAME = 'xo.edward.test';

const main = await startStaticServer(ROOT, MAIN_PORT);
await startStaticServer(ROOT, CROSS_ORIGIN_PORT);

const xo = `http://${PUBLIC_NAME}:${CROSS_ORIGIN_PORT}/`;
const xp = `http://127.0.0.1:${CROSS_ORIGIN_PORT}/`;
const pages = ['profile', 'form', 'comments', 'contact', 'query-links', 'secret-form', 'iframe', 'canvas', 'faces', 'images-text', 'images', 'agent-form'];
console.log(`Fixtures on ${main.url} (Ctrl+C to stop)\n`);
for (const name of pages) console.log(`  ${main.url}pages/${name}.html`);
console.log(`  ${main.url}pages/images-unreadable.html?xo=${encodeURIComponent(xo)}&xp=${encodeURIComponent(xp)}`);
