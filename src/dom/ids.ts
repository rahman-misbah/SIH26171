// Short generated ids (§5.1: node_id, §5.2: unit_id), scoped to one observation.

export function createIdGenerator(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}${n++}`;
}
