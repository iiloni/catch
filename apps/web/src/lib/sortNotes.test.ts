import type { Note } from '@catch/shared';
import { describe, expect, it } from 'vitest';
import { sortNotes } from './sortNotes';

const note = (id: string, updated: number, created: number, isPinned = false, position = 'a0') =>
  ({ id, isPinned, position, updatedAt: new Date(updated), createdAt: new Date(created) }) as Note;

describe('sortNotes', () => {
  const notes = [note('a', 1, 3), note('b', 3, 1), note('c', 2, 2, true)];

  it('puts pinned notes first, newest edit first by default', () => {
    expect(sortNotes(notes).map((n) => n.id)).toEqual(['c', 'b', 'a']);
  });

  it('sorts by creation time in either direction', () => {
    expect(sortNotes(notes, 'createdAt', 'asc').map((n) => n.id)).toEqual(['c', 'b', 'a']);
    expect(sortNotes(notes, 'createdAt', 'desc').map((n) => n.id)).toEqual(['c', 'a', 'b']);
  });

  it('follows the arrangement by code unit, newest first on a tie', () => {
    const arranged = [
      note('a', 0, 1, false, 'a1'),
      note('b', 0, 2, false, 'Zz'),
      note('c', 0, 3, false, 'a1'),
    ];
    expect(sortNotes(arranged, 'position').map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });
});
