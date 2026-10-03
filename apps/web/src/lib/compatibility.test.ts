import { API_PROTOCOL_HEADER, API_PROTOCOL_VERSION } from '@catch/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./serverUrl', () => ({ getServerUrl: () => 'https://catch.example' }));
const fetcher = vi.fn();
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const compatible = { min: API_PROTOCOL_VERSION, max: API_PROTOCOL_VERSION };
const newer = { min: API_PROTOCOL_VERSION + 1, max: API_PROTOCOL_VERSION + 1 };
beforeEach(() => {
  vi.resetModules();
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('client compatibility transport', () => {
  it('pauses a refused shape, preserves pending writes, and resumes after sign-in', async () => {
    fetcher.mockResolvedValueOnce(json(compatible)).mockResolvedValueOnce(json({}, 401));
    const { compatibleShapeFetch } = await import('./compatibility');
    const { addPendingWrite, getSyncStatus, updateSyncStatus } = await import('./syncStatus');
    addPendingWrite('queued');
    const pending = compatibleShapeFetch('https://catch.example/api/shapes/notes');
    await vi.waitFor(() => expect(getSyncStatus().signedOut).toBe(true));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(getSyncStatus().pending).toBe(1);
    fetcher.mockResolvedValueOnce(json([]));
    updateSyncStatus({ signedOut: false });
    expect((await pending).status).toBe(200);
    expect(getSyncStatus().pending).toBe(1);
  });

  it('aborts a refused shape while waiting for sign-in', async () => {
    fetcher.mockResolvedValueOnce(json(compatible)).mockResolvedValueOnce(json({}, 401));
    const { compatibleShapeFetch } = await import('./compatibility');
    const { getSyncStatus } = await import('./syncStatus');
    const controller = new AbortController();
    const pending = compatibleShapeFetch('https://catch.example/api/shapes/notes', {
      signal: controller.signal,
    });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(getSyncStatus().signedOut).toBe(true));
    controller.abort();
    await assertion;
  });

  it('coalesces bootstrap checks and declares its protocol without losing auth headers', async () => {
    fetcher.mockImplementation(async (url: string) =>
      json(url.endsWith('/compatibility') ? compatible : {}),
    );
    const { compatibleFetch } = await import('./compatibility');
    await Promise.all([
      compatibleFetch('https://catch.example/api/notes', {
        headers: { Authorization: 'Bearer token' },
      }),
      compatibleFetch('https://catch.example/api/shapes/notes'),
    ]);
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).endsWith('/compatibility')),
    ).toHaveLength(1);
    const headers = fetcher.mock.calls.find(([url]) => String(url).endsWith('/notes'))?.[1]
      .headers as Headers;
    expect(headers.get(API_PROTOCOL_HEADER)).toBe(String(API_PROTOCOL_VERSION));
    expect(headers.get('Authorization')).toBe('Bearer token');
  });

  it.each([
    ['client-too-old', newer, 200],
    ['server-too-old', null, 404],
    ['server-too-old', { min: 1, max: 1 }, 200],
  ] as const)('blocks %s before sending data', async (issue, range, status) => {
    fetcher.mockResolvedValueOnce(json(range, status));
    const { compatibleFetch, CompatibilityError } = await import('./compatibility');
    await expect(
      compatibleFetch('https://catch.example/api/notes', { method: 'POST' }),
    ).rejects.toBeInstanceOf(CompatibilityError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const { getSyncStatus } = await import('./syncStatus');
    expect(getSyncStatus().incompatibility).toBe(issue);
  });

  it('detects an upgrade that races a successful bootstrap check', async () => {
    fetcher
      .mockResolvedValueOnce(json(compatible))
      .mockResolvedValueOnce(
        json({ code: 'INCOMPATIBLE_PROTOCOL', error: 'Update', protocol: newer }, 426),
      );
    const { compatibleFetch, CompatibilityError } = await import('./compatibility');
    await expect(compatibleFetch('https://catch.example/api/notes')).rejects.toBeInstanceOf(
      CompatibilityError,
    );
    const { getSyncStatus } = await import('./syncStatus');
    expect(getSyncStatus().incompatibility).toBe('client-too-old');
  });

  it('preserves pending counts and resumes a paused shape after compatibility returns', async () => {
    fetcher.mockResolvedValueOnce(json(newer));
    const { compatibleShapeFetch, checkCompatibility } = await import('./compatibility');
    const { addPendingWrite, getSyncStatus } = await import('./syncStatus');
    addPendingWrite('queued');
    const pending = compatibleShapeFetch('https://catch.example/api/shapes/notes');
    await vi.waitFor(() => expect(getSyncStatus().incompatibility).toBe('client-too-old'));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(getSyncStatus().pending).toBe(1);
    fetcher.mockResolvedValueOnce(json(compatible)).mockResolvedValueOnce(json([]));
    await checkCompatibility(true);
    expect((await pending).status).toBe(200);
    expect(getSyncStatus().incompatibility).toBeNull();
    expect(getSyncStatus().pending).toBe(1);
  });

  it('aborts paused shapes without waiting for an update', async () => {
    fetcher.mockResolvedValueOnce(json(newer));
    const { compatibleShapeFetch } = await import('./compatibility');
    const { getSyncStatus } = await import('./syncStatus');
    const controller = new AbortController();
    const pending = compatibleShapeFetch('https://catch.example/api/shapes/notes', {
      signal: controller.signal,
    });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(getSyncStatus().incompatibility).toBe('client-too-old'));
    controller.abort();
    await assertion;
  });

  it.each([new Error('Offline'), json({ min: 2, max: 1 }), json({}, 503)])(
    'keeps unavailable or malformed bootstrap responses retryable',
    async (response) => {
      if (response instanceof Error) fetcher.mockRejectedValueOnce(response);
      else fetcher.mockResolvedValueOnce(response);
      const { ensureCompatible } = await import('./compatibility');
      await expect(ensureCompatible()).rejects.not.toHaveProperty('name', 'ZodError');
      fetcher.mockResolvedValueOnce(json(compatible));
      await expect(ensureCompatible()).resolves.toBeUndefined();
    },
  );
});
