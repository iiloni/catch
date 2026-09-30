import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportBatch, ImportedNote } from './notes';

vi.mock('./auth', () => ({ getSignedInUser: () => ({ id: 'user-1' }) }));
vi.mock('./attachments', () => ({ hasAttachment: vi.fn(() => false), importAttachment: vi.fn() }));
vi.mock('./notes', () => ({ importNotes: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

/** A fresh copy of the store and its neighbours, as after the app restarts. */
async function load() {
  vi.resetModules();
  const imports = await import('./imports');
  const notes = await import('./notes');
  const attachments = await import('./attachments');
  const syncStatus = await import('./syncStatus');
  return {
    ...imports,
    importAttachment: vi.mocked(attachments.importAttachment),
    hasAttachment: vi.mocked(attachments.hasAttachment),
    importNotes: vi.mocked(notes.importNotes),
    ...syncStatus,
  };
}

/** Batches whose writes the test settles, pending in the sync status as real writes are. */
function batches(
  counts: number[],
  addPendingWrite: (id: string) => void,
): {
  batches: ImportBatch[];
  save: (index: number) => Promise<void>;
  fail: (index: number) => Promise<void>;
} {
  const settlers: { resolve: () => void; reject: () => void }[] = [];
  const list = counts.map((count, index) => {
    const id = `tx-${index}`;
    addPendingWrite(id);
    const persisted = new Promise<void>((resolve, reject) => {
      settlers.push({ resolve, reject });
    });
    persisted.catch(() => {});
    return { id, count, persisted };
  });
  const settle = (index: number, how: 'resolve' | 'reject') =>
    act(async () => {
      settlers[index]?.[how]();
      await Promise.resolve();
    });
  return {
    batches: list,
    save: (index) => settle(index, 'resolve'),
    fail: (index) => settle(index, 'reject'),
  };
}

const notes: ImportedNote[] = [];

beforeEach(() => localStorage.clear());
afterEach(() => vi.clearAllMocks());

describe('imports', () => {
  it('follows the server taking an import, batch by batch', async () => {
    const store = await load();
    const writes = batches([50, 30], store.addPendingWrite);
    store.importNotes.mockReturnValue(writes.batches);
    const { result } = renderHook(() => store.useImport());

    act(() => {
      expect(store.startImport('Google Keep', 'user-1', notes)).toBe(80);
    });
    expect(result.current).toEqual({
      source: 'Google Keep',
      total: 80,
      saved: 0,
      failed: 0,
      attachmentTotal: 0,
      attachmentSaved: 0,
      attachmentFailed: 0,
      preparing: 0,
      finished: false,
    });

    await writes.save(0);
    expect(result.current).toMatchObject({ saved: 50, failed: 0, finished: false });
    await writes.fail(1);
    expect(result.current).toMatchObject({ saved: 50, failed: 30, finished: true });
    // Someone was watching, so there is no toast.
    expect(toast.success).not.toHaveBeenCalled();

    act(() => store.dismissImport());
    expect(result.current).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('waits for how a batch it wrote settles, not just for it to stop pending', async () => {
    const store = await load();
    const writes = batches([50], store.addPendingWrite);
    store.importNotes.mockReturnValue(writes.batches);
    const { result } = renderHook(() => store.useImport());
    act(() => {
      store.startImport('Google Keep', 'user-1', notes);
    });

    act(() => store.settlePendingWrite('tx-0'));
    expect(result.current).toMatchObject({ saved: 0, finished: false });
    await writes.fail(0);
    expect(result.current).toMatchObject({ saved: 0, failed: 50, finished: true });
  });

  it('picks an import up again after the app restarts', async () => {
    const before = await load();
    const writes = batches([50, 50, 20], before.addPendingWrite);
    before.importNotes.mockReturnValue(writes.batches);
    before.startImport('Google Keep', 'user-1', notes);
    await writes.save(0);

    // The outbox restores the writes it still holds: here, the last one.
    const after = await load();
    after.addPendingWrite('tx-2');
    const { result } = renderHook(() => after.useImport());
    expect(result.current).toMatchObject({ total: 120, saved: 100, finished: false });

    act(() => after.settlePendingWrite('tx-2'));
    expect(result.current).toMatchObject({ saved: 120, finished: true });
  });

  it('queues attachments after notes, follows their uploads and skips ids already here', async () => {
    const store = await load();
    const writes = batches([1, 1], store.addPendingWrite);
    store.importNotes.mockReturnValue([writes.batches[0]!]);
    store.importAttachment.mockResolvedValue(writes.batches[1]!);
    store.hasAttachment.mockImplementation((id) => id === 'old');
    const file = new File(['binary'], 'photo.png', { type: 'image/png' });
    let release: (file: File) => void = () => {};
    const read = vi.fn(
      () =>
        new Promise<File>((resolve) => {
          release = resolve;
        }),
    );
    const sources = ['old', 'new'].map((id) => ({
      id,
      noteId: 'note',
      createdAt: new Date(),
      read,
    }));
    const { result } = renderHook(() => store.useImport());
    act(() => {
      store.startImport('Google Keep', 'user-1', notes, sources);
    });
    expect(read).toHaveBeenCalledOnce();
    expect(result.current).toMatchObject({
      total: 1,
      attachmentTotal: 1,
      preparing: 1,
      finished: false,
    });
    await writes.save(0);
    expect(result.current?.finished).toBe(false);
    expect(() => store.startImport('Google Keep', 'user-1', notes)).toThrow(/already running/);
    await act(async () => {
      release(file);
      await Promise.resolve();
    });
    expect(store.importAttachment).toHaveBeenCalledWith(sources[1], file, expect.any(AbortSignal));
    expect(result.current).toMatchObject({ preparing: 0, attachmentSaved: 0, finished: false });
    await writes.save(1);
    expect(result.current).toMatchObject({ saved: 1, attachmentSaved: 1, finished: true });
  });

  it('reports extraction failures and continues with the remaining files', async () => {
    const store = await load();
    store.hasAttachment.mockReturnValue(false);
    store.importNotes.mockReturnValue([]);
    store.importAttachment.mockResolvedValue({
      id: 'file-tx',
      count: 1,
      persisted: Promise.resolve(),
    });
    const sources = [
      {
        id: 'broken',
        noteId: 'note',
        createdAt: new Date(),
        read: async () => {
          throw new Error('Damaged file');
        },
      },
      {
        id: 'good',
        noteId: 'note',
        createdAt: new Date(),
        read: async () => new File(['good'], 'good.txt'),
      },
    ];
    const { result } = renderHook(() => store.useImport());
    await act(async () => {
      store.startImport('Google Keep', 'user-1', notes, sources);
    });
    expect(result.current).toMatchObject({
      attachmentTotal: 2,
      attachmentSaved: 1,
      attachmentFailed: 1,
      preparing: 0,
      finished: true,
    });
  });

  it('reports unstaged files after a restart while retaining queued uploads', async () => {
    localStorage.setItem(
      'catch-import-user-1',
      JSON.stringify({
        source: 'Google Keep',
        preparing: 2,
        batches: [{ id: 'queued-file', count: 1, kind: 'attachments', outcome: null }],
      }),
    );
    const store = await load();
    store.addPendingWrite('queued-file');
    const { result } = renderHook(() => store.useImport());
    expect(result.current).toMatchObject({
      attachmentTotal: 3,
      attachmentFailed: 2,
      preparing: 0,
      finished: false,
    });
    act(() => store.settlePendingWrite('queued-file'));
    expect(result.current).toMatchObject({
      attachmentSaved: 1,
      attachmentFailed: 2,
      finished: true,
    });
  });

  it('says when an import finishes while nobody is on the page', async () => {
    const store = await load();
    const writes = batches([50, 2], store.addPendingWrite);
    store.importNotes.mockReturnValue(writes.batches);
    store.startImport('Google Keep', 'user-1', notes);

    await writes.save(0);
    await writes.save(1);
    expect(toast.success).toHaveBeenCalledWith('52 notes imported from Google Keep');
  });
});
