import type { Tag } from '@catch/shared';
import { describe, expect, it } from 'vitest';
import { indexTagTree } from './tagTreeIndex';

const root: Tag = {
  id: 'root',
  userId: 'ada',
  name: 'Work',
  parentId: null,
  color: null,
  icon: null,
};
const child: Tag = { ...root, id: 'child', name: 'Projects', parentId: root.id };
const leaf: Tag = { ...child, id: 'leaf', name: 'Catch', parentId: child.id };

describe('indexed tag tree', () => {
  it('searches ancestor names through collapsed branches without rebuilding paths', () => {
    const index = indexTagTree([root, child, leaf]);
    expect(index.visibleRows('', new Set([root.id])).map(({ tag }) => tag.id)).toEqual([root.id]);
    expect(index.visibleRows('work', new Set([root.id])).map(({ tag }) => tag.id)).toEqual([
      root.id,
      child.id,
      leaf.id,
    ]);
    expect(index.visibleRows('catch', new Set()).map(({ tag }) => tag.id)).toEqual([leaf.id]);
    expect(index.pathFor(leaf.id)).toEqual([root, child, leaf]);
    expect(index.pathFor(leaf.id)).toBe(index.pathFor(leaf.id));
    expect(index.hasChildren(child.id)).toBe(true);
    expect(index.hasChildren(leaf.id)).toBe(false);
  });
  it('filters a 5000-level tree iteratively and keeps incomplete branches visible', () => {
    const tags = Array.from(
      { length: 5000 },
      (_, i): Tag => ({ ...root, id: String(i), parentId: i ? String(i - 1) : null }),
    );
    const index = indexTagTree(tags);
    expect(index.visibleRows('', new Set(['0']))).toHaveLength(1);
    expect(index.visibleRows('work', new Set(['0']))).toHaveLength(5000);
    expect(index.pathFor('4999')).toHaveLength(5000);
    expect(indexTagTree([leaf]).visibleRows('', new Set())).toEqual([{ tag: leaf, depth: 0 }]);
  });
});
