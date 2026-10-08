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

import { resolveLinkCapturePlacement } from './linkCapturePlacement';

beforeEach(() => {
  mocks.columns.clear();
  mocks.tags.clear();
});
describe('link capture placement', () => {
  it('keeps Gallery and falls back to the default Deck column if a selected column was deleted', () => {
    const placement = {
      status: null,
      color: 'red' as const,
      primaryTagId: null,
      secondaryTagIds: [],
    };
    expect(resolveLinkCapturePlacement(placement)).toEqual(placement);
    mocks.columns.set('custom', {});
    expect(resolveLinkCapturePlacement({ ...placement, status: 'custom' }).status).toBe('custom');
    mocks.columns.clear();
    expect(resolveLinkCapturePlacement({ ...placement, status: 'custom' }).status).toBe('new');
  });
  it('filters deleted tags and normalizes hierarchical secondary tags without duplicating the primary', () => {
    const base = { userId: 'user', createdAt: new Date(), updatedAt: new Date(), icon: null };
    mocks.tags.set('root', { ...base, id: 'root', name: 'Reading', parentId: null, color: 'blue' });
    mocks.tags.set('child', { ...base, id: 'child', name: 'Web', parentId: 'root', color: null });
    mocks.tags.set('primary', {
      ...base,
      id: 'primary',
      name: 'Primary',
      parentId: null,
      color: null,
    });
    const placement = {
      status: null,
      color: 'default' as const,
      primaryTagId: 'primary',
      secondaryTagIds: ['primary', 'root', 'child', 'deleted'],
    };
    expect(resolveLinkCapturePlacement(placement)).toEqual({
      ...placement,
      secondaryTagIds: ['child'],
    });
    mocks.tags.delete('primary');
    expect(resolveLinkCapturePlacement(placement)).toEqual({
      ...placement,
      primaryTagId: null,
      secondaryTagIds: ['child'],
    });
  });
});
