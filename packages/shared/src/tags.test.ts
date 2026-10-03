import { describe, expect, it } from 'vitest';
import {
  createTagSchema,
  normalizeSecondaryTags,
  secondaryTagAncestors,
  type Tag,
  tagColor,
  tagPath,
  tagSubtreeIds,
  tagTree,
} from './tags';

function tag(index: number, parentId: string | null = null): Tag {
  return {
    id: `0199a0a0-0000-7000-8000-${String(index).padStart(12, '0')}`,
    userId: 'ada',
    name: `Tag ${index}`,
    parentId,
    color: null,
    icon: null,
  };
}
describe('nested tags', () => {
  it('walks thousands of levels without recursion or an arbitrary depth limit', () => {
    const tags: Tag[] = [];
    for (let index = 0; index < 5000; index++) tags.push(tag(index, tags.at(-1)?.id ?? null));
    tags[0]!.color = 'blue';
    const leaf = tags.at(-1)!;
    expect(tagPath(tags, leaf.id)).toHaveLength(5000);
    expect(tagColor(tags, leaf.id)).toBe('blue');
    expect(tagTree(tags).at(-1)?.depth).toBe(4999);
    expect(tagSubtreeIds(tags, tags[0]!.id).size).toBe(5000);
  });
  it('guards cycles and incomplete synced parents', () => {
    const root = tag(1);
    const child = tag(2, root.id);
    root.parentId = child.id;
    expect(tagPath([root, child], child.id)).toHaveLength(2);
    expect(tagSubtreeIds([root, child], root.id).size).toBe(2);
    expect(tagPath([child], child.id)).toEqual([child]);
    expect(tagColor([child], child.id)).toBe('default');
    expect(tagTree([child])).toEqual([{ tag: child, depth: 0 }]);
  });
  it('only roots have icons or linked colors, and No color is not linkable', () => {
    const root = tag(1);
    expect(createTagSchema.safeParse({ ...root, color: 'default' }).success).toBe(false);
    expect(createTagSchema.safeParse({ ...tag(2, root.id), color: 'blue' }).success).toBe(false);
    expect(createTagSchema.safeParse({ ...tag(2, root.id), icon: 'house' }).success).toBe(false);
    expect(createTagSchema.safeParse({ ...root, color: 'blue', icon: 'house' }).success).toBe(true);
  });
  it('keeps only deepest secondaries in each branch, preserving siblings and unrelated tags', () => {
    const root = tag(1);
    const child = tag(2, root.id);
    const leaf = tag(3, child.id);
    const sibling = tag(4, child.id);
    const other = tag(5);
    const tags = [root, child, leaf, sibling, other];
    expect(
      normalizeSecondaryTags(tags, [root.id, child.id, leaf.id, sibling.id, other.id, leaf.id]),
    ).toEqual([leaf.id, sibling.id, other.id]);
    expect(secondaryTagAncestors(tags, [leaf.id]).get(root.id)).toBe(leaf.id);
    expect(normalizeSecondaryTags(tags, [root.id])).toEqual([root.id]);
    expect(normalizeSecondaryTags([leaf], [leaf.id, 'not-yet-synced'])).toEqual([
      leaf.id,
      'not-yet-synced',
    ]);
  });
});
