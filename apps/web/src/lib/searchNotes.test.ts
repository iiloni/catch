import type { Note } from '@catch/shared';
import { describe, expect, it } from 'vitest';
import { highlight, mergeHybridResults, searchNotes } from './searchNotes';

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
    position: 'a0',
    hiddenLinks: [],
    galleryPreviewUrl: null,
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
  it('can browse notes prefiltered by tags without text or a color', () => {
    expect(searchNotes([groceries, books], '', null, true).map((result) => result.note)).toEqual([
      books,
      groceries,
    ]);
    expect(
      searchNotes([groceries, books], '', 'default', true).map((result) => result.note),
    ).toEqual([groceries]);
  });

  it('treats regex characters literally', () => {
    expect(highlight('a+b', ['+'])).toEqual([
      { text: 'a', match: false },
      { text: '+', match: true },
      { text: 'b', match: false },
    ]);
  });
});

describe('merging hybrid ranks with device edits', () => {
  it('keeps server order, prepends pending keyword edits, and rejects stale semantic hits', () => {
    const old = note('Old', []);
    const pending = note('bike pending', []);
    const related = note('Bicycle trip', []);
    const result = mergeHybridResults(
      [old, pending, related],
      searchNotes([pending], 'bike'),
      {
        hits: [
          { id: old.id, updatedAt: new Date(0).toISOString(), semantic: true },
          { id: related.id, updatedAt: related.updatedAt.toISOString(), semantic: true },
        ],
        indexing: false,
      },
      'bike',
      'user-1',
      new Set([pending.id]),
    );
    expect(result.map((row) => row.note.id)).toEqual([pending.id, related.id]);
    expect(result[1]?.semantic).toBe(true);
  });
  it('keeps hybrid hits within the page limit when many synced keywords are unranked', () => {
    const synced = Array.from({ length: 120 }, () => note('bike keyword', []));
    const related = note('Bicycle trip', []);
    const pending = note('bike pending', []);
    const result = mergeHybridResults(
      [...synced, related, pending],
      searchNotes([...synced, pending], 'bike'),
      {
        hits: [{ id: related.id, updatedAt: related.updatedAt.toISOString(), semantic: true }],
        indexing: false,
      },
      'bike',
      'user-1',
      new Set([pending.id]),
    ).slice(0, 60);
    expect(result[0]?.note.id).toBe(pending.id);
    expect(result[1]?.note.id).toBe(related.id);
    expect(result).toHaveLength(60);
  });
  it('does not reinsert an unconfirmed or revoked shared keyword copy', () => {
    const shared = note('bike shared', [], { userId: 'owner' });
    const keyword = searchNotes([shared], 'bike');
    expect(mergeHybridResults([shared], keyword, undefined, 'bike', 'user-1')).toEqual(keyword);
    expect(
      mergeHybridResults([shared], keyword, { hits: [], indexing: false }, 'bike', 'user-1'),
    ).toEqual([]);
    const hit = { id: shared.id, updatedAt: shared.updatedAt.toISOString(), semantic: false };
    expect(
      mergeHybridResults([shared], keyword, { hits: [hit], indexing: false }, 'bike', 'user-1'),
    ).toHaveLength(1);
    expect(
      mergeHybridResults([], keyword, { hits: [hit], indexing: false }, 'bike', 'user-1'),
    ).toEqual([]);
  });
});
