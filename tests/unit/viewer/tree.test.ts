import { describe, expect, it } from 'vitest';
import type { SanitizedNode } from '@/dom/types';
import { buildTree, type TreeNode } from '@/viewer/tree';

const node = (node_id: string, parent_id: string | null): SanitizedNode => ({
  node_id,
  parent_id,
  tag: 'div',
  node_type: 'element',
  bbox: { x: 0, y: 0, w: 1, h: 1 },
  visible: true,
  in_viewport: true,
  content: {},
});

const shape = (trees: TreeNode[]): unknown => trees.map((t) => [t.node.node_id, shape(t.children)]);

describe('buildTree (viewer demo tooling)', () => {
  it('nests nodes under their parents in list order', () => {
    expect(shape(buildTree([node('a', null), node('b', 'a'), node('c', 'a'), node('d', 'b')]))).toEqual([['a', [['b', [['d', []]]], ['c', []]]]]);
  });

  it('keeps a node whose parent was left out as a root instead of dropping it', () => {
    expect(shape(buildTree([node('a', null), node('orphan', 'trimmed-away')]))).toEqual([
      ['a', []],
      ['orphan', []],
    ]);
  });
});
