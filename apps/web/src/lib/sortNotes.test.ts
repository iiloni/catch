import type { Note } from '@catch/shared';
import { describe, expect, it } from 'vitest';
import { sortNotes } from './sortNotes';

const note = (id: string, updated: number, created: number, isPinned = false) =>
  ({ id, isPinned, updatedAt: new Date(updated), createdAt: new Date(created) }) as Note;

describe('sortNotes', () => {
  const notes = [note('a', 1, 3), note('b', 3, 1), note('c', 2, 2, true)];

  it('puts pinned notes first, newest edit first by default', () => {
    expect(sortNotes(notes).map((n) => n.id)).toEqual(['c', 'b', 'a']);
  });

  it('sorts by creation time in either direction', () => {
    expect(sortNotes(notes, 'createdAt', 'asc').map((n) => n.id)).toEqual(['c', 'b', 'a']);
    expect(sortNotes(notes, 'createdAt', 'desc').map((n) => n.id)).toEqual(['c', 'a', 'b']);
  });
});
