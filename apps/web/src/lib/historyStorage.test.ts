import {
  HISTORY_FORMAT,
  type HistoryCapture,
  type HistoryVersion,
  historyCaptureSchema,
} from '@catch/shared';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import {
  allHistoryRecords,
  cacheHistoryVersion,
  deleteHistoryStorage,
  forgetClearedHistory,
  markHistoryRejected,
  stageFrozenHistory,
} from './historyStorage';

vi.mock('./auth', () => ({ getSignedInUser: () => ({ id: 'history-storage-test' }) }));
const noteId = '0199a0a0-0000-7000-8000-000000000001';
const parent: HistoryVersion & { data: string; format: 1 } = {
  id: '0199a0a0-0000-7000-8000-000000000002',
  noteId,
  epoch: noteId,
  sequence: 1,
  capturedAt: new Date(0),
  receivedAt: new Date(0),
  reason: 'baseline',
  representation: 'snapshot',
  parentId: null,
  depth: 0,
  contentKey: 'a'.repeat(64),
  payloadKey: 'b'.repeat(64),
  format: HISTORY_FORMAT,
  data: 'YWJj',
};
const capture: HistoryCapture = historyCaptureSchema.parse({
  ...parent,
  id: '0199a0a0-0000-7000-8000-000000000003',
  kind: 'note',
  originId: noteId,
  sourceKey: null,
  parentId: parent.id,
  representation: 'delta',
  depth: 1,
});
afterEach(async () => {
  await deleteHistoryStorage('history-storage-test');
  vi.unstubAllGlobals();
});
it('clears downloaded versions while preserving an unsynced version and its independent recovery snapshot', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  await cacheHistoryVersion(parent);
  const fallback = {
    ...capture,
    representation: 'snapshot' as const,
    depth: 0,
    parentId: null,
    data: 'ZGVm',
  };
  await stageFrozenHistory(capture, fallback);
  await markHistoryRejected(capture.id);
  await forgetClearedHistory(noteId, noteId);
  expect(await allHistoryRecords()).toEqual([
    expect.objectContaining({ id: capture.id, rejected: true, fallback }),
  ]);
});
it('removes a signed-out account’s history database', async () => {
  const factory = new IDBFactory();
  vi.stubGlobal('indexedDB', factory);
  await cacheHistoryVersion(parent);
  await deleteHistoryStorage('history-storage-test');
  expect(await factory.databases()).toEqual([]);
});
