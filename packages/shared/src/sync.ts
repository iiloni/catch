import { z } from 'zod';

/**
 * What a write endpoint returns: the Postgres transaction id, so the client can wait for
 * Electric to stream the write back. Null when the write was already applied (a replay of a
 * create or delete that reached the server before), so there is nothing new to wait for.
 */
export const txidResponseSchema = z.object({ txid: z.number().int().nullable() });

export type TxidResponse = z.infer<typeof txidResponseSchema>;
