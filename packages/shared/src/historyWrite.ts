import { z } from 'zod';

/** Stable identifiers survive outbox replay; older clients omit the envelope. */
export const historyWriteSchema = z.object({
  operationId: z.uuid({ version: 'v7' }),
  originId: z.uuid({ version: 'v7' }),
  contentKey: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  /** For a vault note, how the content being written reads; see `historyVersionSchema`. */
  readingKey: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export type HistoryWrite = z.infer<typeof historyWriteSchema>;
