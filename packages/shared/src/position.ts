import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * Notes are arranged by `position`, a fractional index: a base-62 string that sorts
 * between its neighbours, so moving a note rewrites only that note, even offline.
 * Compare positions by code unit (as `comparePositions` does), never with
 * `localeCompare` or a Postgres text collation, which fold case.
 */
export function comparePositions(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A position that sorts after `before` and before `after` (either may be null for the
 * start or end). Two devices can hand out the same position, so equal bounds are
 * possible; then `after` is ignored rather than throwing.
 */
export function positionBetween(before: string | null, after: string | null): string {
  if (before !== null && after !== null && before >= after) after = null;
  return generateKeyBetween(before, after);
}

/** `count` positions in order, all between `before` and `after` (as `positionBetween`). */
export function positionsBetween(
  before: string | null,
  after: string | null,
  count: number,
): string[] {
  if (before !== null && after !== null && before >= after) after = null;
  return generateNKeysBetween(before, after, count);
}
