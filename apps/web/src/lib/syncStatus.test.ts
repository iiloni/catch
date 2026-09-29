import { describe, expect, it } from 'vitest';
import { addPendingWrite, getSyncStatus, settlePendingWrite, updateSyncStatus } from './syncStatus';

describe('pending writes', () => {
  it('counts each write until it settles', () => {
    addPendingWrite('a');
    addPendingWrite('b');
    addPendingWrite('a');
    expect(getSyncStatus().pending).toBe(2);
    settlePendingWrite('a');
    expect(getSyncStatus().pending).toBe(1);
    settlePendingWrite('b');
    expect(getSyncStatus().pending).toBe(0);
  });

  it('never counts a write that settled before it was added', () => {
    settlePendingWrite('early');
    addPendingWrite('early');
    expect(getSyncStatus().pending).toBe(0);
  });
});

describe('updateSyncStatus', () => {
  it('keeps the same snapshot when nothing changes', () => {
    const before = getSyncStatus();
    updateSyncStatus({ offline: before.offline });
    expect(getSyncStatus()).toBe(before);
    updateSyncStatus({ offline: !before.offline });
    expect(getSyncStatus()).not.toBe(before);
    updateSyncStatus({ offline: before.offline });
  });
});
