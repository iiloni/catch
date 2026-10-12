import { hybridSearchSchema } from '@catch/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AiRequestError, ai } from './ai';
import { useSemanticSearch } from './semanticSearch';
import { updateSyncStatus } from './syncStatus';

vi.mock('./ai', () => ({
  AiRequestError: class extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
  ai: { capabilities: vi.fn(), search: vi.fn() },
}));
beforeEach(() => {
  vi.clearAllMocks();
  updateSyncStatus({ offline: false, signedOut: false, incompatibility: null });
  vi.mocked(ai.capabilities).mockResolvedValue({ enabled: true, indexing: false });
  vi.mocked(ai.search).mockResolvedValue({ hits: [], indexing: false });
});
afterEach(() => {
  vi.useRealTimers();
});
const input = hybridSearchSchema.parse({ query: 'bike' });
it('defaults off and requires connectivity; an older server falls back', async () => {
  vi.mocked(ai.capabilities).mockRejectedValue(new AiRequestError(404, 'missing'));
  const hook = renderHook(() => useSemanticSearch(input, false));
  await waitFor(() => expect(hook.result.current.available).toBe(false));
  expect(hook.result.current.enabled).toBe(false);
  expect(ai.search).not.toHaveBeenCalled();
  hook.unmount();
  act(() => updateSyncStatus({ offline: true }));
  vi.clearAllMocks();
  const offline = renderHook(() => useSemanticSearch(input, false));
  expect(offline.result.current.allowed).toBe(false);
  expect(ai.capabilities).not.toHaveBeenCalled();
});
it('does not check capabilities or send queries in the vault, including after exit', async () => {
  const hook = renderHook(({ vault }) => useSemanticSearch(input, vault), {
    initialProps: { vault: false },
  });
  await waitFor(() => expect(hook.result.current.allowed).toBe(true));
  act(() => hook.result.current.setEnabled(true));
  hook.rerender({ vault: true });
  vi.clearAllMocks();
  expect(hook.result.current.enabled).toBe(false);
  await new Promise((resolve) => setTimeout(resolve, 550));
  expect(ai.search).not.toHaveBeenCalled();
  expect(ai.capabilities).not.toHaveBeenCalled();
  hook.rerender({ vault: false });
  await new Promise((resolve) => setTimeout(resolve, 550));
  expect(ai.search).not.toHaveBeenCalled();
});
it('searches at once when switched on, and waits out typing', async () => {
  const hook = renderHook(({ query }) => useSemanticSearch({ ...input, query }, false), {
    initialProps: { query: 'bike' },
  });
  await waitFor(() => expect(hook.result.current.allowed).toBe(true));
  vi.useFakeTimers();
  act(() => hook.result.current.setEnabled(true));
  expect(hook.result.current.loading).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(ai.search).toHaveBeenCalledTimes(1);
  expect(hook.result.current.loading).toBe(false);
  hook.rerender({ query: 'bikes' });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(ai.search).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  expect(ai.search).toHaveBeenCalledTimes(2);
});
it('keeps the last answer while the next loads, and reports only a slow search', async () => {
  const first = {
    hits: [{ id: 'a', updatedAt: new Date(0).toISOString(), semantic: true }],
    indexing: false,
  };
  vi.mocked(ai.search).mockResolvedValueOnce(first);
  const hook = renderHook(({ query }) => useSemanticSearch({ ...input, query }, false), {
    initialProps: { query: 'bike' },
  });
  await waitFor(() => expect(hook.result.current.allowed).toBe(true));
  vi.useFakeTimers();
  act(() => hook.result.current.setEnabled(true));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(hook.result.current.result).toEqual(first);
  expect(hook.result.current.loading).toBe(false);
  let complete!: (value: { hits: []; indexing: boolean }) => void;
  vi.mocked(ai.search).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  hook.rerender({ query: 'bikes' });
  expect(hook.result.current.loading).toBe(true);
  expect(hook.result.current.result).toEqual(first);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(449);
  });
  expect(hook.result.current.slow).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(hook.result.current.slow).toBe(true);
  await act(async () => {
    complete({ hits: [], indexing: false });
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(hook.result.current.slow).toBe(false);
  expect(hook.result.current.result?.hits).toEqual([]);
  // Switching AI off drops the answer, so switching it back on cannot show the old one.
  act(() => hook.result.current.setEnabled(false));
  expect(hook.result.current.result).toBeUndefined();
});
it('debounces, cancels stale requests and ignores late results', async () => {
  const hook = renderHook(({ query }) => useSemanticSearch({ ...input, query }, false), {
    initialProps: { query: 'bike' },
  });
  await waitFor(() => expect(hook.result.current.allowed).toBe(true));
  vi.useFakeTimers();
  let complete!: (value: { hits: []; indexing: boolean }) => void;
  vi.mocked(ai.search).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  act(() => hook.result.current.setEnabled(true));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  const signal = vi.mocked(ai.search).mock.calls[0]![1]!;
  hook.rerender({ query: 'milk' });
  expect(signal.aborted).toBe(true);
  await act(async () => {
    complete({ hits: [], indexing: true });
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(hook.result.current.result?.indexing).toBe(false);
  expect(vi.mocked(ai.search).mock.calls[1]![0].query).toBe('milk');
});

it('refreshes an indexing response, then stops when indexing completes or mode turns off', async () => {
  vi.mocked(ai.search)
    .mockResolvedValueOnce({ hits: [], indexing: true })
    .mockResolvedValue({ hits: [], indexing: false });
  const hook = renderHook(() => useSemanticSearch(input, false));
  await waitFor(() => expect(hook.result.current.allowed).toBe(true));
  vi.useFakeTimers();
  act(() => hook.result.current.setEnabled(true));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(hook.result.current.result?.indexing).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(hook.result.current.result?.indexing).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(ai.search).toHaveBeenCalledTimes(2);
  act(() => hook.result.current.setEnabled(false));
  vi.mocked(ai.search).mockResolvedValue({ hits: [], indexing: true });
  act(() => hook.result.current.setEnabled(true));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  act(() => hook.result.current.setEnabled(false));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(ai.search).toHaveBeenCalledTimes(3);
});

it.each([429, 503, 'network'] as const)(
  'recovers from transient %s without editing the query and cancels retries',
  async (failure) => {
    const error =
      failure === 'network'
        ? new TypeError('fetch failed')
        : new AiRequestError(failure, 'unavailable');
    vi.mocked(ai.search)
      .mockRejectedValueOnce(error)
      .mockResolvedValue({ hits: [], indexing: false });
    const hook = renderHook(() => useSemanticSearch(input, false));
    await waitFor(() => expect(hook.result.current.allowed).toBe(true));
    vi.useFakeTimers();
    act(() => hook.result.current.setEnabled(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(hook.result.current.message).toContain('Showing keyword results');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_999);
    });
    expect(ai.search).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(ai.search).toHaveBeenCalledTimes(2);
    expect(hook.result.current.message).toBeNull();
    act(() => hook.result.current.setEnabled(false));
    vi.mocked(ai.search).mockRejectedValue(error);
    act(() => hook.result.current.setEnabled(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    act(() => hook.result.current.setEnabled(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(ai.search).toHaveBeenCalledTimes(3);
  },
);
it.each([404, 403])('does not retry a permanent %s response', async (status) => {
  vi.mocked(ai.search).mockRejectedValue(new AiRequestError(status, 'missing'));
  const hook = renderHook(() => useSemanticSearch(input, false));
  await waitFor(() => expect(hook.result.current.allowed).toBe(true));
  vi.useFakeTimers();
  act(() => hook.result.current.setEnabled(true));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_500);
  });
  expect(ai.search).toHaveBeenCalledTimes(1);
});
