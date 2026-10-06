import type { OfflineTransaction } from '@tanstack/offline-transactions';
import { describe, expect, it } from 'vitest';
import { mergeQueuedWrites } from './mergeQueuedWrites';

type Mutation = { type: string; key: string; collection?: string; changes?: object };

const queued = (id: string, at: number, ...mutations: Mutation[]) =>
  ({
    id,
    idempotencyKey: id,
    createdAt: new Date(at),
    mutations: mutations.map(({ type, key, collection = 'notes', changes = {} }) => ({
      type,
      globalKey: `${collection}:${key}`,
      collection: { id: collection },
      changes,
    })),
  }) as unknown as OfflineTransaction;

const save = (key: string, text: string) => ({
  type: 'update',
  key,
  changes: { content: [text], updatedAt: new Date() },
});

const ids = (transactions: OfflineTransaction[]) => transactions.map((t) => t.id);

describe('mergeQueuedWrites', () => {
  it('keeps only the last content save of each note, in order', () => {
    const merged = mergeQueuedWrites(
      [
        queued('3', 3, save('a', 'three')),
        queued('1', 1, save('a', 'one')),
        queued('2', 2, save('b', 'two')),
        queued('4', 4, save('b', 'four')),
      ],
      'notes',
    );
    expect(ids(merged)).toEqual(['3', '4']);
  });

  it('keeps saves that change more than the content', () => {
    const merged = mergeQueuedWrites(
      [
        queued('1', 1, { type: 'update', key: 'a', changes: { content: [], color: 'red' } }),
        queued('2', 2, save('a', 'two')),
      ],
      'notes',
    );
    expect(ids(merged)).toEqual(['1', '2']);
  });

  it('keeps everything that is not a lone content save', () => {
    const merged = mergeQueuedWrites(
      [
        queued('1', 1, { type: 'insert', key: 'a', changes: { content: [] } }),
        queued('2', 2, save('a', 'x'), save('b', 'y')),
        queued('3', 3, { type: 'update', key: 'a', collection: 'board-columns' }),
        queued('4', 4, save('a', 'z'), save('b', 'w')),
      ],
      'notes',
    );
    expect(ids(merged)).toEqual(['1', '2', '3', '4']);
  });

  it('keeps a content save that only a delete follows', () => {
    const merged = mergeQueuedWrites(
      [queued('1', 1, save('a', 'one')), queued('2', 2, { type: 'delete', key: 'a' })],
      'notes',
    );
    expect(ids(merged)).toEqual(['1', '2']);
  });

  it('keeps writes made in the same millisecond in the order they were made', () => {
    const tag = { ...queued('stored-second', 5, { type: 'insert', key: 't', collection: 'tags' }) };
    const assignment = {
      ...queued('stored-first', 5, { type: 'update', key: 'a', collection: 'note-tags' }),
    };
    tag.idempotencyKey = '0199b2f0-0000-7000-8000-000000000001';
    assignment.idempotencyKey = '0199b2f0-0000-7000-8000-000000000002';
    expect(ids(mergeQueuedWrites([assignment, tag], 'notes'))).toEqual([
      'stored-second',
      'stored-first',
    ]);
  });
});
