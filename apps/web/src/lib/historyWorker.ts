import type { HistoryReview, HistoryState } from '@catch/shared';
import type { EncodedHistory } from '@catch/shared/historyCodec';
import type { HistoryWorkerRequest, HistoryWorkerResult } from './history.worker';

let worker: Worker | null = null;
const comparisons = new Set<Worker>();
let nextId = 0;
const waiting = new Map<
  number,
  {
    resolve: (result: Extract<HistoryWorkerResult, { result: unknown }>['result']) => void;
    reject: (error: Error) => void;
  }
>();
function run(request: HistoryWorkerRequest) {
  worker ??= new Worker(new URL('./history.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<HistoryWorkerResult>) => {
    const response = event.data;
    const promise = waiting.get(response.id);
    waiting.delete(response.id);
    if ('error' in response) promise?.reject(new Error(response.error));
    else promise?.resolve(response.result);
  };
  worker.onerror = () => stopHistoryWorker();
  return new Promise<Extract<HistoryWorkerResult, { result: unknown }>['result']>(
    (resolve, reject) => {
      waiting.set(request.id, { resolve, reject });
      worker!.postMessage(request);
    },
  );
}
export async function encodeHistoryInWorker(
  state: HistoryState,
  previous?: { state: HistoryState; depth: number },
) {
  const result = await run({ id: ++nextId, operation: 'encode', state, previous });
  if (!('encoded' in result)) throw new Error('Unexpected history response.');
  return result;
}
export async function decodeHistoryInWorker(
  chain: { representation: 'snapshot' | 'delta'; data: Uint8Array<ArrayBuffer> }[],
) {
  const result = await run({ id: ++nextId, operation: 'decode', chain });
  if (!('state' in result)) throw new Error('Unexpected history response.');
  return result.state;
}
export function stopHistoryWorker() {
  for (const worker of comparisons) {
    worker.dispatchEvent(new Event('error'));
    worker.terminate();
  }
  comparisons.clear();
  worker?.terminate();
  worker = null;
  for (const promise of waiting.values())
    promise.reject(new Error('The history worker was stopped.'));
  waiting.clear();
}
export type { EncodedHistory };

/** Comparison can be canceled without interrupting durable capture on the other worker. */
export function compareHistoryInWorker(
  before: HistoryState,
  after: HistoryState,
  signal: AbortSignal,
) {
  const worker = new Worker(new URL('./history.worker.ts', import.meta.url), { type: 'module' });
  comparisons.add(worker);
  return new Promise<HistoryReview>((resolve, reject) => {
    const abort = () => {
      worker.terminate();
      comparisons.delete(worker);
      reject(new DOMException('Comparison canceled.', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<HistoryWorkerResult>) => {
      signal.removeEventListener('abort', abort);
      worker.terminate();
      comparisons.delete(worker);
      if ('result' in event.data && 'review' in event.data.result)
        resolve(event.data.result.review);
      else reject(new Error('This comparison could not be opened.'));
    };
    worker.onerror = () => {
      signal.removeEventListener('abort', abort);
      worker.terminate();
      comparisons.delete(worker);
      reject(new Error('This comparison could not be opened.'));
    };
    if (signal.aborted) abort();
    else
      worker.postMessage({
        id: 1,
        operation: 'compare',
        before,
        after,
      } satisfies HistoryWorkerRequest);
  });
}
