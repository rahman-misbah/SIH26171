// Demo tooling (M12): the observation's `dom` is a flat list linked by
// parent_id (§5.1). Rebuild the tree so the viewer can render it in page
// order. A node whose parent isn't in the list (e.g. the parent was trimmed
// by the §14.2 budget) becomes a root rather than disappearing.

import type { SanitizedNode } from '@/dom/types';

export interface TreeNode {
  node: SanitizedNode;
  children: TreeNode[];
}

export function buildTree(nodes: SanitizedNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const node of nodes) byId.set(node.node_id, { node, children: [] });

  const roots: TreeNode[] = [];
  for (const node of nodes) {
    const self = byId.get(node.node_id);
    if (!self) continue;
    const parent = node.parent_id === null ? undefined : byId.get(node.parent_id);
    if (parent && parent !== self) parent.children.push(self);
    else roots.push(self);
  }
  return roots;
}
