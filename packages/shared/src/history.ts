import { z } from 'zod';
import { noteSchema } from './notes';
import { vaultFileSchema, vaultNoteSchema } from './vault';

/** Protocol 6: history is separate from the live note and is owner-only. */
export const HISTORY_FORMAT = 1;
export const HISTORY_ANCHOR_INTERVAL = 32;
export const HISTORY_MAX_VERSIONS = 128;
export const HISTORY_MAX_BYTES = 16 * 1024 * 1024;
export const HISTORY_IDLE_MS = 30_000;
export const HISTORY_CONTINUOUS_MS = 5 * 60_000;

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const base64 = z
  .string()
  .max(Math.ceil((HISTORY_MAX_BYTES * 4) / 3) + 128)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/);
export const historyKindSchema = z.enum(['note', 'vault']);
export type HistoryKind = z.infer<typeof historyKindSchema>;
export const historyReasonSchema = z.enum([
  'baseline',
  'edit',
  'before-restore',
  'restored',
  'recovered',
]);
export const historyStateSchema = z.object({
  content: z.array(
    z.custom<Record<string, unknown>>(
      (value) => value !== null && typeof value === 'object' && !Array.isArray(value),
    ),
  ),
  files: z.array(vaultFileSchema).default([]),
});
export type HistoryState = z.infer<typeof historyStateSchema>;

export const historySummarySchema = z.object({
  id: z.uuid({ version: 'v7' }),
  userId: z.string(),
  kind: historyKindSchema,
  epoch: z.uuid({ version: 'v7' }),
  contentToken: z.uuid({ version: 'v7' }),
  latestCaptureId: z.uuid({ version: 'v7' }).nullable(),
  versionCount: z.number().int().nonnegative(),
  updatedAt: z.coerce.date(),
});
export type HistorySummary = z.infer<typeof historySummarySchema>;

export const historyVersionSchema = z.object({
  id: z.uuid({ version: 'v7' }),
  noteId: z.uuid({ version: 'v7' }),
  epoch: z.uuid({ version: 'v7' }),
  sequence: z.number().int().nonnegative(),
  capturedAt: z.coerce.date(),
  receivedAt: z.coerce.date(),
  reason: historyReasonSchema,
  representation: z.enum(['snapshot', 'delta', 'vault-note']),
  parentId: z.uuid({ version: 'v7' }).nullable(),
  depth: z
    .number()
    .int()
    .min(0)
    .max(HISTORY_ANCHOR_INTERVAL - 1),
  contentKey: digest,
  payloadKey: digest,
});
export type HistoryVersion = z.infer<typeof historyVersionSchema>;

export const historyCaptureSchema = historyVersionSchema
  .omit({ sequence: true, receivedAt: true })
  .extend({
    kind: historyKindSchema,
    originId: z.uuid({ version: 'v7' }),
    format: z.literal(HISTORY_FORMAT),
    data: base64.min(1),
    sourceKey: digest.nullable(),
  });
export type HistoryCapture = z.infer<typeof historyCaptureSchema>;

export const historyListSchema = z.object({
  summary: historySummarySchema,
  versions: z.array(historyVersionSchema).max(HISTORY_MAX_VERSIONS),
  nextCursor: z.number().int().positive().nullable(),
});
export type HistoryList = z.infer<typeof historyListSchema>;

export const historyArchiveSchema = z.object({
  epoch: z.uuid({ version: 'v7' }),
  versions: z
    .array(historyVersionSchema.extend({ data: base64.min(1), format: z.literal(HISTORY_FORMAT) }))
    .min(1)
    .max(HISTORY_ANCHOR_INTERVAL),
});
export type HistoryArchive = z.infer<typeof historyArchiveSchema>;

export const historyRestoreContextSchema = z.object({
  summary: historySummarySchema,
  note: noteSchema.nullable(),
  vaultNote: vaultNoteSchema.nullable(),
});
export type HistoryRestoreContext = z.infer<typeof historyRestoreContextSchema>;

export const historyRestoreSchema = z.object({
  operationId: z.uuid({ version: 'v7' }),
  versionId: z.uuid({ version: 'v7' }),
  epoch: z.uuid({ version: 'v7' }),
  expectedToken: z.uuid({ version: 'v7' }),
  /** Vault content is merged with authoritative current settings and sealed on the device. */
  data: vaultNoteSchema.shape.data.optional(),
});
export type HistoryRestore = z.infer<typeof historyRestoreSchema>;
export const historyRestoreResultSchema = historyRestoreContextSchema.extend({
  operationId: z.uuid({ version: 'v7' }),
  txid: z.number().nullable(),
  superseded: z.boolean(),
});
export type HistoryRestoreResult = z.infer<typeof historyRestoreResultSchema>;
export const historyErrorSchema = z.object({
  code: z.enum([
    'HISTORY_RESTORE_STALE',
    'HISTORY_EPOCH_CHANGED',
    'HISTORY_PARENT_MISSING',
    'HISTORY_INTEGRITY',
    'HISTORY_OPERATION_REUSED',
  ]),
  error: z.string(),
});

export const historyCaptureResultSchema = z.object({
  version: historyVersionSchema.nullable(),
  txid: z.number().nullable(),
  versionId: z.uuid({ version: 'v7' }).nullable(),
});
export type HistoryCaptureResult = z.infer<typeof historyCaptureResultSchema>;

export const historyClearSchema = z.object({
  epoch: z.uuid({ version: 'v7' }),
  expectedToken: z.uuid({ version: 'v7' }),
});
export type HistoryClear = z.infer<typeof historyClearSchema>;
export const historyClearResultSchema = z.object({
  summary: historySummarySchema,
  txid: z.number(),
});
export type HistoryClearResult = z.infer<typeof historyClearResultSchema>;
