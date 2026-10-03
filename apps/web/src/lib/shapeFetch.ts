import { uuidv7 } from 'uuidv7';
import { compatibleShapeFetch } from './compatibility';

/** Keep HTTP development sync from occupying every browser connection (ADR 0007). */
export const shapeFetch: typeof fetch = async (input, init) => {
  if (!import.meta.env.DEV) return compatibleShapeFetch(input, init);
  const url = new URL(input instanceof Request ? input.url : input.toString(), location.href);
  if (url.protocol !== 'http:' || url.searchParams.get('live') !== 'true')
    return compatibleShapeFetch(input, init);

  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  // Wait on the device, where the delay consumes no connection. Catch-up requests stay fast.
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason);
    };
    const timer = setTimeout(finish, 1000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
  // Read from the same handle/offset without holding the connection open for new rows.
  url.searchParams.delete('live');
  url.searchParams.delete('live_sse');
  url.searchParams.delete('experimental_live_sse');
  const cursor = uuidv7();
  url.searchParams.set('cache-buster', cursor);
  const request = input instanceof Request ? new Request(url, input) : url;
  const response = await compatibleShapeFetch(request, { ...init, cache: 'no-store' });
  if (!response.ok) return response;
  // Electric validates this header for live requests. Non-live reads omit it, so supply
  // an opaque cache cursor while keeping the actual shape handle and offset unchanged.
  const headers = new Headers(response.headers);
  headers.set('electric-cursor', cursor);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
