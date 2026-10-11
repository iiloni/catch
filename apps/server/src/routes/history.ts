import {
  blocksToPlainText,
  historyCaptureSchema,
  historyClearSchema,
  historyRestoreSchema,
} from '@catch/shared';
import { canonicalHistory } from '@catch/shared/historyCodec';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import {
  historyPayloads,
  historyRestores,
  historyVersions,
  noteHistory,
  notes,
  vaultNotes,
} from '../db/schema';
import {
  appendHistory,
  claimOperation,
  digest,
  ensureHistory,
  type HistoryControl,
  HistoryFailure,
  type HistoryTx,
  historyArchive,
  lockHistoryNote,
  ordinaryHistoryState,
  preserveOrdinary,
  preserveVault,
  publicSummary,
  publicVersion,
  versionScope,
} from '../history/store';
import { requireUser } from '../lib/requireUser';
import { refreshSharedNote } from '../lib/sharing';
import { queuePreviews, trackNoteLinks } from '../linkPreviews';

const idParam = zValidator('param', z.object({ id: z.uuid({ version: 'v7' }) }));
const versionParam = zValidator(
  'param',
  z.object({ id: z.uuid({ version: 'v7' }), versionId: z.uuid({ version: 'v7' }) }),
);
const operationParam = zValidator(
  'param',
  z.object({ id: z.uuid({ version: 'v7' }), operationId: z.uuid({ version: 'v7' }) }),
);
const txid = async (tx: HistoryTx) => {
  const [row] = await tx.execute<{ txid: string }>(
    sql`select pg_current_xact_id()::xid::text as txid`,
  );
  return Number(row?.txid);
};
const earliest = (control: HistoryControl) => control.firstSequence;

const failure = (error: unknown) => {
  if (error instanceof HistoryFailure) return error;
  throw error;
};

export const historyRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .use(async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  })
  .get(
    '/:id',
    idParam,
    zValidator('query', z.object({ cursor: z.coerce.number().int().positive().optional() })),
    async (c) => {
      const userId = c.get('user')!.id;
      const { id } = c.req.valid('param');
      const { cursor } = c.req.valid('query');
      const result = await db.transaction(async (tx) => {
        const live = await lockHistoryNote(tx, userId, id);
        if (!live) return null;
        const control = await ensureHistory(tx, userId, id, live.kind);
        const rows = await tx
          .select()
          .from(historyVersions)
          .where(
            and(
              versionScope(userId, id, control.epoch),
              gte(historyVersions.sequence, earliest(control)),
              cursor ? lt(historyVersions.sequence, cursor) : undefined,
            ),
          )
          .orderBy(desc(historyVersions.sequence))
          .limit(51);
        return {
          summary: publicSummary(control),
          versions: rows.slice(0, 50).map(publicVersion),
          nextCursor: rows.length > 50 ? rows[49]!.sequence : null,
        };
      });
      return result ? c.json(result) : c.json({ error: 'Note not found' }, 404);
    },
  )
  .get('/:id/versions/:versionId', versionParam, async (c) => {
    const userId = c.get('user')!.id;
    const { id, versionId } = c.req.valid('param');
    try {
      const result = await db.transaction(async (tx) => {
        const live = await lockHistoryNote(tx, userId, id);
        if (!live) return null;
        const control = await ensureHistory(tx, userId, id, live.kind);
        const [selected] = await tx
          .select({ id: historyVersions.id })
          .from(historyVersions)
          .where(
            and(
              versionScope(userId, id, control.epoch),
              eq(historyVersions.id, versionId),
              gte(historyVersions.sequence, earliest(control)),
            ),
          );
        return selected ? historyArchive(tx, control, versionId) : null;
      });
      return result ? c.json(result) : c.json({ error: 'Version not found' }, 404);
    } catch (error) {
      const problem = failure(error);
      return c.json({ code: problem.code, error: problem.message }, 409);
    }
  })
  .post('/:id/captures', idParam, zValidator('json', historyCaptureSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    try {
      const result = await db.transaction(async (tx) => {
        const live = await lockHistoryNote(tx, userId, id);
        if (!live) return null;
        const control = await ensureHistory(tx, userId, id, live.kind);
        if (body.noteId !== id || body.kind !== live.kind)
          throw new HistoryFailure(
            'HISTORY_INTEGRITY',
            'This checkpoint does not belong to this note.',
          );
        if (body.epoch !== control.epoch)
          throw new HistoryFailure(
            'HISTORY_EPOCH_CHANGED',
            'History changed while this device was offline. The local version can still be saved as a new note.',
          );
        if (
          !(await claimOperation(
            tx,
            control,
            'capture',
            body.originId,
            body.id,
            digest(canonicalHistory(body)),
          ))
        )
          return { txid: null, versionId: null, version: null };
        const outcome = await appendHistory(tx, control, body);
        const [version] = await tx
          .select()
          .from(historyVersions)
          .where(and(versionScope(userId, id, control.epoch), eq(historyVersions.id, outcome.id)));
        return {
          txid: outcome.added ? await txid(tx) : null,
          versionId: outcome.id,
          version: version ? publicVersion(version) : null,
        };
      });
      return result ? c.json(result) : c.json({ error: 'Note not found' }, 404);
    } catch (error) {
      const problem = failure(error);
      return c.json({ code: problem.code, error: problem.message }, 409);
    }
  })
  .post('/:id/clear', idParam, zValidator('json', historyClearSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    try {
      const result = await db.transaction(async (tx) => {
        const live = await lockHistoryNote(tx, userId, id);
        if (!live) return null;
        const control = await ensureHistory(tx, userId, id, live.kind);
        if (control.epoch !== body.epoch || control.contentToken !== body.expectedToken)
          throw new HistoryFailure(
            'HISTORY_RESTORE_STALE',
            'This note or its history changed. Review it before clearing history.',
          );
        await tx.delete(historyVersions).where(versionScope(userId, id, control.epoch));
        await tx
          .delete(historyPayloads)
          .where(
            and(
              eq(historyPayloads.userId, userId),
              eq(historyPayloads.noteId, id),
              eq(historyPayloads.epoch, control.epoch),
            ),
          );
        const [updated] = await tx
          .update(noteHistory)
          .set({
            epoch: uuidv7(),
            contentToken: uuidv7(),
            latestCaptureId: null,
            versionCount: 0,
            nextSequence: 0,
            firstSequence: 1,
            lastCheckpointAt: null,
          })
          .where(and(eq(noteHistory.userId, userId), eq(noteHistory.id, id)))
          .returning();
        return { summary: publicSummary(updated!), txid: await txid(tx) };
      });
      return result ? c.json(result) : c.json({ error: 'Note not found' }, 404);
    } catch (error) {
      const problem = failure(error);
      return c.json({ code: problem.code, error: problem.message }, 409);
    }
  })
  .get('/:id/restore-context', idParam, async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const result = await db.transaction(async (tx) => {
      const live = await lockHistoryNote(tx, userId, id);
      if (!live) return null;
      const control = await ensureHistory(tx, userId, id, live.kind);
      return { summary: publicSummary(control), note: live.note, vaultNote: live.vaultNote };
    });
    return result ? c.json(result) : c.json({ error: 'Note not found' }, 404);
  })
  .get('/:id/restores/:operationId', operationParam, async (c) => {
    const userId = c.get('user')!.id;
    const { id, operationId } = c.req.valid('param');
    const result = await db.transaction(async (tx) => {
      const live = await lockHistoryNote(tx, userId, id);
      if (!live) return null;
      const [receipt] = await tx
        .select()
        .from(historyRestores)
        .where(
          and(
            eq(historyRestores.userId, userId),
            eq(historyRestores.noteId, id),
            eq(historyRestores.operationId, operationId),
          ),
        );
      if (!receipt) return null;
      const control = await ensureHistory(tx, userId, id, live.kind);
      return {
        operationId,
        summary: publicSummary(control),
        note: live.note,
        vaultNote: live.vaultNote,
        txid: null,
        superseded: receipt.resultToken !== control.contentToken,
      };
    });
    return result ? c.json(result) : c.json({ error: 'Restore not found' }, 404);
  })
  .post('/:id/restore', idParam, zValidator('json', historyRestoreSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    try {
      const result = await db.transaction(async (tx) => {
        const live = await lockHistoryNote(tx, userId, id);
        if (!live) return null;
        const control = await ensureHistory(tx, userId, id, live.kind);
        const requestDigest = digest(canonicalHistory(body));
        const [receipt] = await tx
          .select()
          .from(historyRestores)
          .where(
            and(
              eq(historyRestores.userId, userId),
              eq(historyRestores.noteId, id),
              eq(historyRestores.operationId, body.operationId),
            ),
          );
        if (receipt) {
          if (receipt.digest !== requestDigest)
            throw new HistoryFailure(
              'HISTORY_OPERATION_REUSED',
              'This restore id is already in use.',
            );
          return {
            response: {
              operationId: body.operationId,
              summary: publicSummary(control),
              note: live.note,
              vaultNote: live.vaultNote,
              txid: null,
              superseded: receipt.resultToken !== control.contentToken,
            },
            links: [],
            readers: [],
          };
        }
        if (body.epoch !== control.epoch)
          throw new HistoryFailure(
            'HISTORY_EPOCH_CHANGED',
            'History has changed. Review the available versions again.',
          );
        if (body.expectedToken !== control.contentToken)
          throw new HistoryFailure(
            'HISTORY_RESTORE_STALE',
            'This note changed on another device. Review its current content before restoring.',
          );
        if (live.note?.deletedAt)
          throw new HistoryFailure(
            'HISTORY_RESTORE_STALE',
            'Restore this note from Trash before replacing its content.',
          );
        const [version] = await tx
          .select()
          .from(historyVersions)
          .where(
            and(
              versionScope(userId, id, control.epoch),
              eq(historyVersions.id, body.versionId),
              gte(historyVersions.sequence, earliest(control)),
            ),
          );
        if (!version)
          throw new HistoryFailure(
            'HISTORY_PARENT_MISSING',
            'This version is no longer available.',
          );
        let links: string[] = [];
        let readers: Awaited<ReturnType<typeof refreshSharedNote>> = [];
        let updatedNote = live.note;
        let updatedVaultNote = live.vaultNote;
        if (live.note) {
          if (body.data !== undefined)
            throw new HistoryFailure('HISTORY_INTEGRITY', 'Unexpected sealed content.');
          const selected = await ordinaryHistoryState(tx, control, version.id);
          await preserveOrdinary(tx, control, live.note.content, 'before-restore');
          updatedNote =
            (
              await tx
                .update(notes)
                .set({ content: selected.content, searchText: blocksToPlainText(selected.content) })
                .where(and(eq(notes.userId, userId), eq(notes.id, id)))
                .returning()
            )[0] ?? null;
          links = await trackNoteLinks(tx, userId, [selected.content]);
          readers = await refreshSharedNote(tx, id, userId);
          await preserveOrdinary(tx, control, selected.content, 'restored');
        } else if (live.vaultNote) {
          if (!body.data)
            throw new HistoryFailure(
              'HISTORY_INTEGRITY',
              'The vault needs content sealed on an unlocked device.',
            );
          await preserveVault(tx, control, live.vaultNote.data, 'before-restore');
          updatedVaultNote =
            (
              await tx
                .update(vaultNotes)
                .set({ data: body.data })
                .where(and(eq(vaultNotes.userId, userId), eq(vaultNotes.id, id)))
                .returning()
            )[0] ?? null;
          await preserveVault(tx, control, body.data, 'restored');
        }
        control.contentToken = uuidv7();
        await tx
          .update(noteHistory)
          .set({ contentToken: control.contentToken, lastOriginId: null })
          .where(and(eq(noteHistory.userId, userId), eq(noteHistory.id, id)));
        await tx.insert(historyRestores).values({
          userId,
          noteId: id,
          operationId: body.operationId,
          digest: requestDigest,
          resultToken: control.contentToken,
        });
        return {
          response: {
            operationId: body.operationId,
            summary: publicSummary(control),
            note: updatedNote ?? null,
            vaultNote: updatedVaultNote ?? null,
            txid: await txid(tx),
            superseded: false,
          },
          links,
          readers,
        };
      });
      if (!result) return c.json({ error: 'Note not found' }, 404);
      queuePreviews(userId, result.links);
      for (const reader of result.readers) queuePreviews(reader.userId, reader.links);
      return c.json(result.response);
    } catch (error) {
      const problem = failure(error);
      return c.json({ code: problem.code, error: problem.message }, 409);
    }
  });
