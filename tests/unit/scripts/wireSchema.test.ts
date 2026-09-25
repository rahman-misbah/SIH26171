// §12.3: docs/wire/*.schema.json must match the TypeScript wire types, and
// the limits they state must be the ones the validator enforces (§13.1).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_ACTIONS_PER_STEP, MAX_THOUGHT_LENGTH, MAX_WAIT_MS } from '@/agent/schema';
import { generateWireSchemas, WIRE_SCHEMA_DIR } from '../../../scripts/wireSchemaGen.ts';

// The generator type-walks the project, which takes a few seconds.
const generated = generateWireSchemas();

describe('wire protocol JSON Schemas', () => {
  it.each(Object.keys(generated))('docs/wire/%s is up to date (run `npm run wire-schema`)', (file) => {
    expect(readFileSync(path.join(WIRE_SCHEMA_DIR, file), 'utf8')).toBe(generated[file]);
  });

  it('states the same limits the validator enforces', () => {
    const schema = JSON.parse(generated['agent-response.schema.json']!) as {
      definitions: { AgentResponse: { properties: { thought: { maxLength: number }; actions: { maxItems: number } } }; Action: { anyOf: { properties: { type: { const: string }; ms?: { maximum: number } } }[] } };
    };
    const response = schema.definitions.AgentResponse.properties;
    expect(response.thought.maxLength).toBe(MAX_THOUGHT_LENGTH);
    expect(response.actions.maxItems).toBe(MAX_ACTIONS_PER_STEP);
    const wait = schema.definitions.Action.anyOf.find((a) => a.properties.type.const === 'wait');
    expect(wait?.properties.ms?.maximum).toBe(MAX_WAIT_MS);
  });
});
