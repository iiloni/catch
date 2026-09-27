import type { Note } from '@catch/shared';
import { describe, expect, it } from 'vitest';
import { highlight, searchNotes } from './searchNotes';

let counter = 0;
function note(title: string, body: string[], overrides: Partial<Note> = {}): Note {
  counter += 1;
  return {
    id: `0199a0a0-0000-7000-8000-${String(counter).padStart(12, '0')}`,
    userId: 'user-1',
    content: [
      { type: 'heading', content: [{ type: 'text', text: title }] },
      ...body.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
    ],
    color: 'default',
    status: null,
    isPinned: false,
    isArchived: false,
    createdAt: new Date(2026, 0, counter),
    updatedAt: new Date(2026, 0, counter),
    deletedAt: null,
    ...overrides,
  };
}

describe('searchNotes', () => {
  const groceries = note('Groceries', ['Oat milk', 'Eggs']);
  const trip = note('Trip packing', ['Charger', 'Groceries for the road']);
  const books = note('Books', ['The Dispossessed'], { color: 'teal' });

  it('requires every word and ranks title matches first', () => {
    const results = searchNotes([trip, groceries, books], 'groceries');
    expect(results.map((result) => result.note)).toEqual([groceries, trip]);
    expect(searchNotes([trip, groceries], 'groceries road').map((r) => r.note)).toEqual([trip]);
  });

  it('highlights matches in the title and the matching line', () => {
    const [result] = searchNotes([trip], 'road');
    expect(result?.title).toEqual([{ text: 'Trip packing', match: false }]);
    expect(result?.snippet).toContainEqual({ text: 'road', match: true });
  });

  it('filters by color without a query', () => {
    expect(searchNotes([groceries, books], '', 'teal').map((r) => r.note)).toEqual([books]);
    expect(searchNotes([groceries, books], '')).toEqual([]);
  });

  it('treats regex characters literally', () => {
    expect(highlight('a+b', ['+'])).toEqual([
      { text: 'a', match: false },
      { text: '+', match: true },
      { text: 'b', match: false },
    ]);
  });
});
