import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteAutosave } from './useNoteAutosave';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  stored: vi.fn(),
  freeze: vi.fn(),
  finish: vi.fn(),
  locks: new Set<() => Promise<void>>(),
}));

vi.mock('./collections', () => ({ waitForWriteStored: mocks.stored }));
vi.mock('./notes', () => ({ getNote: () => ({ id: 'note' }), updateNote: mocks.update }));
vi.mock('./noteHistory', () => ({
  freezeHistory: mocks.freeze,
  finishHistorySession: mocks.finish,
}));
vi.mock('./vault', () => ({ beforeVaultLock: mocks.locks }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.locks.clear();
  mocks.update.mockReturnValue({ isPersisted: { promise: Promise.resolve() } });
  mocks.freeze.mockResolvedValue(undefined);
  mocks.finish.mockResolvedValue(undefined);
});

afterEach(() => vi.useRealTimers());

function pendingStorage() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  mocks.stored.mockReturnValue(promise);
  return { promise, resolve };
}

describe('autosave durability', () => {
  it('a repeated flush still waits for a save already reaching local storage', async () => {
    const storage = pendingStorage();
    const { result, unmount } = renderHook(() => useNoteAutosave('note'));
    act(() => result.current.save([{ type: 'paragraph', content: 'Latest edit' }]));
    const first = result.current.flush();
    let saved = false;
    void first.then(() => {
      saved = true;
    });
    expect(result.current.flush()).toBe(first);
    await act(async () => {
      await Promise.resolve();
    });
    expect(saved).toBe(false);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    await act(async () => {
      storage.resolve();
      await first;
    });
    expect(saved).toBe(true);
    unmount();
  });

  it('vault locking waits for a debounced save before freezing history', async () => {
    const storage = pendingStorage();
    const { result, unmount } = renderHook(() => useNoteAutosave('note'));
    act(() => result.current.save([{ type: 'paragraph', content: 'Sealed edit' }]));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    const locking = Promise.all([...mocks.locks].map((finish) => finish()));
    await Promise.resolve();
    expect(mocks.freeze).not.toHaveBeenCalled();
    storage.resolve();
    await locking;
    expect(mocks.freeze).toHaveBeenCalledWith('note');
    unmount();
  });

  it('unmounting keeps history alive until an in-flight content save is durable', async () => {
    const storage = pendingStorage();
    const { result, unmount } = renderHook(() => useNoteAutosave('note'));
    act(() => result.current.save([{ type: 'paragraph', content: 'Last edit' }]));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    unmount();
    await Promise.resolve();
    expect(mocks.finish).not.toHaveBeenCalled();
    await act(async () => {
      storage.resolve();
      await storage.promise;
    });
    expect(mocks.finish).toHaveBeenCalledWith('note');
  });
  it('reports a failed device save once, then lets the note close', async () => {
    mocks.stored.mockReturnValue(Promise.reject(new Error('disk full')));
    const { result, unmount } = renderHook(() => useNoteAutosave('note'));
    act(() => result.current.save([{ type: 'paragraph', content: 'Unsaved edit' }]));
    await expect(result.current.flush()).rejects.toThrow('disk full');
    await expect(result.current.flush()).rejects.toThrow('disk full');
    await expect(result.current.flush()).resolves.toBeUndefined();
    unmount();
  });
});
