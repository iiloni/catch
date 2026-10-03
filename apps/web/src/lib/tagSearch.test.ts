import type { NoteTags, Tag } from '@catch/shared';
import { describe, expect, it } from 'vitest';
import { indexNoteTags, matchesTagFilter } from './tagSearch';

const root: Tag = {
  id: 'work',
  userId: 'ada',
  name: 'Work',
  parentId: null,
  color: 'blue',
  icon: null,
};
const child: Tag = { ...root, id: 'projects', parentId: root.id, color: null };
const leaf: Tag = { ...child, id: 'catch', parentId: child.id };
const sibling: Tag = { ...child, id: 'ideas' };
const assignment: NoteTags = {
  id: 'note',
  userId: 'ada',
  primaryTagId: leaf.id,
  secondaryTagIds: [sibling.id],
};

describe('tag search', () => {
  const indexed = indexNoteTags(
    [root, child, leaf, sibling],
    new Map([[assignment.id, assignment]]),
  );
  const assigned = indexed.get(assignment.id);
  it('matches both roles and every ancestor without explicit ancestor assignments', () => {
    expect(assigned).toEqual(new Set([leaf.id, sibling.id, child.id, root.id]));
    expect(matchesTagFilter(assigned, { ids: [root.id], match: 'any', untagged: false })).toBe(
      true,
    );
    expect(
      matchesTagFilter(assigned, { ids: [leaf.id, sibling.id], match: 'all', untagged: false }),
    ).toBe(true);
  });
  it('distinguishes any, all and untagged without treating no primary as untagged', () => {
    const filters = { ids: [root.id, 'other'], match: 'any', untagged: false } as const;
    expect(matchesTagFilter(assigned, filters)).toBe(true);
    expect(matchesTagFilter(assigned, { ...filters, match: 'all' })).toBe(false);
    expect(matchesTagFilter(new Set([sibling.id]), { ids: [], match: 'any', untagged: true })).toBe(
      false,
    );
    expect(matchesTagFilter(new Set(), { ids: [], match: 'all', untagged: true })).toBe(true);
    expect(matchesTagFilter(undefined, { ids: [], match: 'any', untagged: true })).toBe(true);
    expect(matchesTagFilter(undefined, { ids: [], match: 'all', untagged: false })).toBe(true);
  });
});
