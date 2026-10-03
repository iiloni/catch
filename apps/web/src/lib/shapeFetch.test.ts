import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compatibleShapeFetch } from './compatibility';
import { shapeFetch } from './shapeFetch';

vi.mock('./compatibility', () => ({ compatibleShapeFetch: vi.fn() }));
const fetcher = vi.mocked(compatibleShapeFetch);
const liveUrl = 'http://catch.example/api/shapes/tags?live=true&handle=tags&offset=0_1';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('DEV', true);
  // Remote HTTP dev URLs lack randomUUID, while getRandomValues remains available.
  vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
  fetcher.mockReset();
  fetcher.mockImplementation(async () => new Response('[]'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('development shape transport', () => {
  it('leaves browser connections free between six live shape reads', async () => {
    const shapes = ['notes', 'board-columns', 'link-previews', 'attachments', 'tags', 'note-tags'];
    const pending = shapes.map((shape) =>
      shapeFetch(`http://catch.example/api/shapes/${shape}?live=true&handle=${shape}&offset=0_1`),
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(fetcher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all(pending);
    expect(fetcher).toHaveBeenCalledTimes(6);
    for (const [input, init] of fetcher.mock.calls) {
      const url = new URL(String(input));
      expect(url.searchParams.has('live')).toBe(false);
      expect(url.searchParams.get('offset')).toBe('0_1');
      expect(url.searchParams.get('handle')).toBe(url.pathname.split('/').at(-1));
      expect(init?.cache).toBe('no-store');
    }
  });

  it('preserves Request auth, cancellation, headers and offsets without mutating the input', async () => {
    const controller = new AbortController();
    const input = new Request(`${liveUrl}&live_sse=true&experimental_live_sse=true&cursor=abc`, {
      signal: controller.signal,
      headers: { Authorization: 'Bearer token' },
    });
    const pending = shapeFetch(input, { headers: { 'x-test': 'override' } });
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    const call = fetcher.mock.calls[0];
    if (!call) throw new Error('Missing shape request');
    const [request, init] = call;
    expect(request).toBeInstanceOf(Request);
    if (!(request instanceof Request)) throw new Error('Expected Request');
    const url = new URL(request.url);
    expect(url.searchParams.get('handle')).toBe('tags');
    expect(url.searchParams.get('offset')).toBe('0_1');
    expect(url.searchParams.get('cursor')).toBe('abc');
    expect(url.searchParams.has('live_sse')).toBe(false);
    expect(url.searchParams.has('experimental_live_sse')).toBe(false);
    expect(request.headers.get('Authorization')).toBe('Bearer token');
    expect(init?.headers).toEqual({ 'x-test': 'override' });
    expect(new URL(input.url).searchParams.get('live')).toBe('true');
    controller.abort();
    expect(request.signal.aborted).toBe(true);
  });

  it('uses a fresh cache key for each read of an unchanged offset', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const pending = shapeFetch(liveUrl);
      await vi.advanceTimersByTimeAsync(1000);
      await pending;
    }
    const urls = fetcher.mock.calls.map(([input]) => new URL(String(input)));
    const [first, second] = urls;
    if (!first || !second) throw new Error('Missing shape requests');
    expect(first.searchParams.get('cache-buster')).toBeTruthy();
    expect(first.searchParams.get('cache-buster')).not.toBe(
      second.searchParams.get('cache-buster'),
    );
  });

  it('preserves sync metadata and supplies the live cursor without changing rows', async () => {
    const body = [{ headers: { control: 'up-to-date', global_last_seen_lsn: '1234' } }];
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify(body), {
        headers: {
          'electric-handle': 'tags',
          'electric-offset': '0_inf',
          'electric-schema': '{}',
          'electric-up-to-date': '',
        },
      }),
    );
    const pending = shapeFetch(liveUrl);
    await vi.advanceTimersByTimeAsync(1000);
    const response = await pending;
    expect(response.headers.get('electric-cursor')).toBeTruthy();
    expect(response.headers.get('electric-handle')).toBe('tags');
    expect(response.headers.get('electric-offset')).toBe('0_inf');
    expect(response.headers.get('electric-schema')).toBe('{}');
    expect(response.headers.has('electric-up-to-date')).toBe(true);
    expect(await response.json()).toEqual(body);
  });

  it.each([409, 503])('preserves a %s response for Electric to recover', async (status) => {
    const response = new Response('[]', { status });
    fetcher.mockResolvedValueOnce(response);
    const pending = shapeFetch(liveUrl);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBe(response);
  });

  it.each([false, true])('cancels a %s pre-aborted poll without sending it', async (preAborted) => {
    const controller = new AbortController();
    if (preAborted) controller.abort();
    const pending = shapeFetch(liveUrl, { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    if (!preAborted) controller.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    'http://catch.example/api/shapes/tags?offset=-1',
    'http://catch.example/api/shapes/tags?offset=0_1&handle=tags',
    'https://catch.example/api/shapes/tags?live=true&offset=0_1&handle=tags',
  ])('keeps initial, catch-up and HTTPS requests unchanged: %s', async (input) => {
    const init = { headers: { Authorization: 'Bearer token' } };
    await shapeFetch(input, init);
    expect(fetcher).toHaveBeenCalledWith(input, init);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps production long polling unchanged even over HTTP', async () => {
    vi.stubEnv('DEV', false);
    await shapeFetch(liveUrl);
    expect(fetcher).toHaveBeenCalledWith(liveUrl, undefined);
    expect(vi.getTimerCount()).toBe(0);
  });
});
