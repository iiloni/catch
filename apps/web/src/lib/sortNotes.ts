import type { Note } from '@catch/shared';

export type SortField = 'updatedAt' | 'createdAt';
export type SortDirection = 'desc' | 'asc';

/** Pinned notes first, then by the chosen timestamp. */
export function sortNotes(
  notes: readonly Note[],
  field: SortField = 'updatedAt',
  direction: SortDirection = 'desc',
) {
  const sign = direction === 'desc' ? -1 : 1;
  return [...notes].sort(
    (a, b) =>
      Number(b.isPinned) - Number(a.isPinned) || sign * (a[field].getTime() - b[field].getTime()),
  );
}
