// `npm run wire-schema`: regenerates docs/wire/*.schema.json from the wire
// types (§12.3). Run after changing SanitizedObservation, AgentResponse or
// BackendCapabilities; tests/unit/scripts/wireSchema.test.ts fails until then.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateWireSchemas, WIRE_SCHEMA_DIR } from './wireSchemaGen.ts';

await mkdir(WIRE_SCHEMA_DIR, { recursive: true });
for (const [file, content] of Object.entries(generateWireSchemas())) {
  await writeFile(path.join(WIRE_SCHEMA_DIR, file), content);
  console.log(`wrote docs/wire/${file}`);
}
