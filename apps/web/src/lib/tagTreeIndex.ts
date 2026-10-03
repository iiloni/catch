import { type Tag, tagTree } from '@catch/shared';

/** Reuse hierarchy data across search and collapse changes instead of indexing per row. */
export function indexTagTree(tags: readonly Tag[]) {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const parents = new Set(tags.flatMap((tag) => (tag.parentId ? [tag.parentId] : [])));
  const rows = tagTree(tags);
  const paths = new Map<string, readonly Tag[]>();
  function pathFor(id: string): readonly Tag[] {
    const cached = paths.get(id);
    if (cached) return cached;
    const path: Tag[] = [];
    const seen = new Set<string>();
    let current = byId.get(id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      path.push(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    path.reverse();
    // Bound retained path memory when scrolling through an extremely deep tree.
    if (paths.size >= 128) paths.delete(paths.keys().next().value!);
    paths.set(id, path);
    return path;
  }
  function visibleRows(query: string, collapsed: ReadonlySet<string>) {
    const ancestry: { hidden: boolean; collapsed: boolean; matches: boolean }[] = [];
    return rows.filter(({ tag, depth }) => {
      const parent = ancestry[depth - 1];
      const hidden = !!parent && (parent.hidden || parent.collapsed);
      const matches = !!parent?.matches || tag.name.toLowerCase().includes(query);
      ancestry[depth] = { hidden, matches, collapsed: collapsed.has(tag.id) };
      return query ? matches : !hidden;
    });
  }
  return { pathFor, visibleRows, hasChildren: (id: string) => parents.has(id) };
}
