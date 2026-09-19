// §5.6: the Element Registry. Replaces DOM attribute injection -- actions
// (M6) resolve `node_id` through this map instead. Rebuilt on each
// observation; a stale/collected reference fails with `stale_node` (§13.3).

export class ElementRegistry {
  private readonly refs = new Map<string, WeakRef<Element>>();

  register(nodeId: string, el: Element): void {
    this.refs.set(nodeId, new WeakRef(el));
  }

  resolve(nodeId: string): Element | undefined {
    return this.refs.get(nodeId)?.deref();
  }

  clear(): void {
    this.refs.clear();
  }
}
