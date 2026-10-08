import type { Tag } from '@catch/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  columns: new Map<string, unknown>(),
  tags: new Map<string, Tag>(),
}));
vi.mock('./collections', () => ({
  boardColumnsCollection: mocks.columns,
  tagsCollection: mocks.tags,
}));
vi.mock('./auth', () => ({ getSignedInUser: () => ({ id: 'user-1' }) }));

import { incomingNoteDefaults, incomingNoteDefaultsKey } from './incomingNoteDefaults';

const parent = '019a0123-4567-7000-8000-000000000001';
const child = '019a0123-4567-7000-8000-000000000002';
const other = '019a0123-4567-7000-8000-000000000003';
const deleted = '019a0123-4567-7000-8000-000000000004';

function save(value: unknown, userId = 'user-1') {
  localStorage.setItem(incomingNoteDefaultsKey(userId), JSON.stringify(value));
}

beforeEach(() => {
  localStorage.clear();
  mocks.columns.clear();
  mocks.columns.set('new', {});
  mocks.columns.set('in_progress', {});
  mocks.tags.clear();
  for (const [id, parentId] of [
    [parent, null],
    [child, parent],
    [other, null],
  ] as const)
    mocks.tags.set(id, { id, parentId, userId: 'user-1', name: id, color: null, icon: null });
});

describe('incoming note defaults', () => {
  it('defaults to Gallery without color or tags, including malformed storage', () => {
    const expected = { status: null, color: 'default', primaryTagId: null, secondaryTagIds: [] };
    expect(incomingNoteDefaults('user-1')).toEqual(expected);
    localStorage.setItem(incomingNoteDefaultsKey('user-1'), '{broken');
    expect(incomingNoteDefaults('user-1')).toEqual(expected);
    save({ color: 'not-a-color' });
    expect(incomingNoteDefaults('user-1')).toEqual(expected);
  });
  it('isolates accounts and follows stable column ids, falling back to the default Deck column', () => {
    save({ status: 'in_progress', color: 'blue' });
    save({ status: null, color: 'red' }, 'user-2');
    expect(incomingNoteDefaults('user-1')).toMatchObject({ status: 'in_progress', color: 'blue' });
    expect(incomingNoteDefaults('user-2')).toMatchObject({ status: null, color: 'red' });
    mocks.columns.set('in_progress', { name: 'Renamed' });
    expect(incomingNoteDefaults('user-1').status).toBe('in_progress');
    mocks.columns.delete('in_progress');
    expect(incomingNoteDefaults('user-1').status).toBe('new');
  });
  it('drops deleted tags, excludes the primary and normalizes secondary ancestors', () => {
    save({
      primaryTagId: other,
      color: 'red',
      secondaryTagIds: [parent, child, child, other, deleted],
    });
    expect(incomingNoteDefaults('user-1')).toEqual({
      status: null,
      color: 'default',
      primaryTagId: other,
      secondaryTagIds: [child],
    });
    mocks.tags.delete(other);
    expect(incomingNoteDefaults('user-1')).toMatchObject({
      primaryTagId: null,
      secondaryTagIds: [child],
    });
  });
});
