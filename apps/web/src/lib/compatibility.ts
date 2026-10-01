import {
  API_PROTOCOL_HEADER,
  API_PROTOCOL_VERSION,
  type CompatibilityIssue,
  protocolCompatibility,
  protocolErrorSchema,
  protocolRangeSchema,
} from '@catch/shared';
import { getServerUrl } from './serverUrl';
import { getSyncStatus, subscribeToSyncStatus, updateSyncStatus } from './syncStatus';

export class CompatibilityError extends Error {
  constructor(readonly issue: CompatibilityIssue) {
    super(issue === 'client-too-old' ? 'Waiting for an app update' : 'Waiting for a server update');
  }
}

let checkedUntil = 0;
let checking: Promise<void> | null = null;

/** The bootstrap endpoint is stable and public, including when data requests are blocked. */
export function checkCompatibility(force = false): Promise<void> {
  if (!force && Date.now() < checkedUntil) return Promise.resolve();
  checking ??= (async () => {
    const response = await fetch(`${getServerUrl()}/api/compatibility`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    // Servers released before protocol 1 have no gate. Never send them new writes.
    if (response.status === 404) {
      updateSyncStatus({ incompatibility: 'server-too-old' });
    } else {
      if (!response.ok) throw new Error('Could not check API compatibility');
      const range = protocolRangeSchema.safeParse(await response.json());
      // A malformed bootstrap response is retryable, never a Zod write-validation failure.
      if (!range.success) throw new Error('Could not verify API compatibility');
      updateSyncStatus({
        incompatibility: protocolCompatibility(API_PROTOCOL_VERSION, range.data),
      });
    }
    checkedUntil = Date.now() + 60_000;
  })().finally(() => {
    checking = null;
  });
  return checking;
}

export async function ensureCompatible() {
  await checkCompatibility();
  const { incompatibility } = getSyncStatus();
  if (incompatibility) throw new CompatibilityError(incompatibility);
}

export const protocolHeaders = { [API_PROTOCOL_HEADER]: String(API_PROTOCOL_VERSION) };

/** Also handles a server upgrade between the bootstrap check and an actual request. */
export async function observeProtocolResponse(response: Response) {
  if (response.status !== 426) return;
  const error = protocolErrorSchema.safeParse(await response.clone().json());
  if (!error.success) throw new Error('Could not verify API compatibility');
  const issue = protocolCompatibility(API_PROTOCOL_VERSION, error.data.protocol);
  if (!issue) throw new Error('The server rejected a supported API protocol');
  updateSyncStatus({ incompatibility: issue });
  checkedUntil = Date.now() + 60_000;
  throw new CompatibilityError(issue);
}

export const compatibleFetch: typeof fetch = async (input, init) => {
  await ensureCompatible();
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => {
    headers.set(key, value);
  });
  headers.set(API_PROTOCOL_HEADER, String(API_PROTOCOL_VERSION));
  const response = await fetch(input, { ...init, headers });
  await observeProtocolResponse(response);
  return response;
};

function waitForCompatibility(signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      unsubscribe();
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(signal.reason);
      else resolve();
    };
    const abort = () => finish();
    const unsubscribe = subscribeToSyncStatus(() => {
      if (!getSyncStatus().incompatibility) finish();
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (!getSyncStatus().incompatibility || signal?.aborted) finish();
  });
}

/** Keep Electric's stream alive but idle; its default handling terminates on a 426. */
export const compatibleShapeFetch: typeof fetch = async (input, init) => {
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  for (;;) {
    signal?.throwIfAborted();
    try {
      return await compatibleFetch(input, init);
    } catch (error) {
      if (!(error instanceof CompatibilityError)) throw error;
      await waitForCompatibility(signal);
    }
  }
};
