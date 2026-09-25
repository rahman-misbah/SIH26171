// §12.3: "JSON Schema files generated from the TypeScript types". Generates
// one schema per wire message from src/backend/http/wire.ts. Shared by the
// writer (scripts/wireSchema.ts, `npm run wire-schema`) and the staleness
// test (tests/unit/scripts/wireSchema.test.ts), so the committed files in
// docs/wire/ can never drift from the types.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGenerator } from 'ts-json-schema-generator';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
export const WIRE_SCHEMA_DIR = path.join(ROOT, 'docs/wire');

// File name -> exported type in wire.ts.
const MESSAGES = {
  'observation.schema.json': 'WireObservation', // POST /v1/decide request body
  'agent-response.schema.json': 'WireAgentResponse', // POST /v1/decide response
  'capabilities.schema.json': 'WireCapabilities', // GET /v1/capabilities response
} as const;

export function generateWireSchemas(): Record<string, string> {
  const generator = createGenerator({
    path: path.join(ROOT, 'src/backend/http/wire.ts'),
    tsconfig: path.join(ROOT, 'tsconfig.json'),
    skipTypeCheck: true, // `npm run check` type-checks; this only reads the types
    expose: 'export',
    jsDoc: 'extended',
  });
  const out: Record<string, string> = {};
  for (const [file, type] of Object.entries(MESSAGES)) {
    out[file] = `${JSON.stringify(generator.createSchema(type), null, 2)}\n`;
  }
  return out;
}
