import { comparePositions, type Note } from '@catch/shared';

/** `position` is the order the user arranged notes in; the dates sort either way. */
export type SortField = 'position' | 'updatedAt' | 'createdAt';
export type SortDirection = 'desc' | 'asc';

/** Pinned notes first, then by the chosen field. */
export function sortNotes(
  notes: readonly Note[],
  field: SortField = 'updatedAt',
  direction: SortDirection = 'desc',
) {
  const sign = direction === 'desc' ? -1 : 1;
  const byField = (a: Note, b: Note) =>
    field === 'position'
      ? comparePositions(a.position, b.position) || b.createdAt.getTime() - a.createdAt.getTime()
      : sign * (a[field].getTime() - b[field].getTime());
  return [...notes].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || byField(a, b));
}
