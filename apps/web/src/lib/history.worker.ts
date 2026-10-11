/// <reference lib="webworker" />
import {
  type HistoryReview,
  type HistoryState,
  historyStateSchema,
  reviewHistory,
} from '@catch/shared';
import {
  decodeHistory,
  type EncodedHistory,
  encodeHistory,
  packHistory,
} from '@catch/shared/historyCodec';
import { z } from 'zod';

const requestSchema = z.discriminatedUnion('operation', [
  z.object({
    id: z.number(),
    operation: z.literal('compare'),
    before: historyStateSchema,
    after: historyStateSchema,
  }),
  z.object({
    id: z.number(),
    operation: z.literal('encode'),
    state: historyStateSchema,
    previous: z
      .object({ state: historyStateSchema, depth: z.number().int().nonnegative() })
      .optional(),
  }),
  z.object({
    id: z.number(),
    operation: z.literal('decode'),
    chain: z
      .array(
        z.object({ representation: z.enum(['snapshot', 'delta']), data: z.instanceof(Uint8Array) }),
      )
      .min(1)
      .max(32),
  }),
]);
export type HistoryWorkerRequest = z.infer<typeof requestSchema>;
export type HistoryWorkerResult =
  | {
      id: number;
      result:
        | { encoded: EncodedHistory; snapshot: Uint8Array<ArrayBuffer> }
        | { state: HistoryState }
        | { review: HistoryReview };
    }
  | { id: number; error: string };

self.onmessage = (event: MessageEvent<unknown>) => {
  const parsed = requestSchema.safeParse(event.data);
  if (!parsed.success) return;
  const request = parsed.data;
  try {
    if (request.operation === 'compare') {
      self.postMessage({
        id: request.id,
        result: { review: reviewHistory(request.before, request.after) },
      } satisfies HistoryWorkerResult);
    } else if (request.operation === 'encode') {
      const encoded = encodeHistory(request.state, request.previous);
      const snapshot =
        encoded.representation === 'snapshot'
          ? encoded.data
          : (encoded.snapshot ?? packHistory(request.state));
      self.postMessage({
        id: request.id,
        result: { encoded, snapshot },
      } satisfies HistoryWorkerResult);
    } else {
      let state: HistoryState | undefined;
      for (const entry of request.chain)
        state = decodeHistory(entry.data, entry.representation, state);
      if (!state) throw new Error();
      self.postMessage({ id: request.id, result: { state } } satisfies HistoryWorkerResult);
    }
  } catch {
    // Errors must not copy private content into logs or a message shown outside the vault.
    self.postMessage({
      id: request.id,
      error: 'This history content could not be encoded or opened.',
    } satisfies HistoryWorkerResult);
  }
};
