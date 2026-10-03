import type { NoteTags, Tag } from '@catch/shared';

export type TagSearchFilter = { ids: readonly string[]; match: 'any' | 'all'; untagged: boolean };

/** Index assigned tags and their ancestors once; primary and secondary roles both match. */
export function indexNoteTags(
  tags: readonly Tag[],
  assignments: ReadonlyMap<string, NoteTags>,
): Map<string, Set<string>> {
  const indexed = new Map<string, Set<string>>();
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const paths = new Map<string, Set<string>>();
  const pathFor = (id: string) => {
    const cached = paths.get(id);
    if (cached) return cached;
    const path = new Set<string>();
    let current: string | null | undefined = id;
    while (current && !path.has(current)) {
      path.add(current);
      current = byId.get(current)?.parentId;
    }
    paths.set(id, path);
    return path;
  };
  for (const [id, assignment] of assignments) {
    const ids = [
      ...assignment.secondaryTagIds,
      ...(assignment.primaryTagId ? [assignment.primaryTagId] : []),
    ];
    indexed.set(id, new Set(ids.flatMap((tagId) => [...pathFor(tagId)])));
  }
  return indexed;
}

export function matchesTagFilter(
  assigned: ReadonlySet<string> | undefined,
  filter: TagSearchFilter,
): boolean {
  if (filter.untagged) return !assigned?.size;
  if (!filter.ids.length) return true;
  const matches = (id: string) => assigned?.has(id) ?? false;
  return filter.match === 'all' ? filter.ids.every(matches) : filter.ids.some(matches);
}
