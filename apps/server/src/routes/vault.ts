import { createVaultNoteSchema, saveVaultSchema, updateVaultNoteSchema } from '@catch/shared';
import { zValidator } from '@hono/zod-validator';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { deleteFiles } from '../attachments/files';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { attachments, reminders, vaultNotes, vaults } from '../db/schema';
import { requireUser } from '../lib/requireUser';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function currentTxid(tx: Tx): Promise<number> {
  const [row] = await tx.execute<{ txid: string }>(
    sql`SELECT pg_current_xact_id()::xid::text AS txid`,
  );
  return Number(row?.txid);
}

const idParam = zValidator('param', z.object({ id: z.uuid() }));

/**
 * The vault (ADR 0020). Devices seal the vault key and every note before sending them, so
 * these routes store and return ciphertext and never see a password, a key or a note.
 */
export const vaultRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .post('/', zValidator('json', saveVaultSchema), async (c) => {
    const userId = c.get('user')!.id;
    const body = c.req.valid('json');
    const result = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(vaults)
        .values({ ...body, userId })
        .onConflictDoNothing()
        .returning({ userId: vaults.userId });
      if (inserted.length > 0) return { txid: await currentTxid(tx) };
      const [existing] = await tx.select().from(vaults).where(eq(vaults.userId, userId));
      // A lost response retried is the same vault. Any other is a second device setting one
      // up before it heard of the first, whose key would lock the first one's notes away.
      return existing?.passwordKey === body.passwordKey && existing.recoveryKey === body.recoveryKey
        ? { txid: null }
        : null;
    });
    if (result === null) return c.json({ error: 'A vault already exists' }, 409);
    return c.json(result, result.txid === null ? 200 : 201);
  })
  // A new password or recovery key seals the same vault key again; the notes are untouched.
  .put('/', zValidator('json', saveVaultSchema), async (c) => {
    const userId = c.get('user')!.id;
    const body = c.req.valid('json');
    const txid = await db.transaction(async (tx) => {
      const updated = await tx
        .update(vaults)
        .set(body)
        .where(eq(vaults.userId, userId))
        .returning({ userId: vaults.userId });
      return updated.length > 0 ? currentTxid(tx) : null;
    });
    if (txid === null) return c.json({ error: 'Vault not found' }, 404);
    return c.json({ txid });
  })
  // Deletes the vault and, through the foreign key, every note in it.
  .delete('/', async (c) => {
    const userId = c.get('user')!.id;
    const result = await db.transaction(async (tx) => {
      // Before the notes go: their reminders and files have no foreign key to follow them out.
      const noteIds = tx
        .select({ id: vaultNotes.id })
        .from(vaultNotes)
        .where(eq(vaultNotes.userId, userId));
      await tx
        .delete(reminders)
        .where(and(eq(reminders.userId, userId), inArray(reminders.noteId, noteIds)));
      const files = await tx
        .delete(attachments)
        .where(and(eq(attachments.userId, userId), inArray(attachments.noteId, noteIds)))
        .returning({ id: attachments.id });
      const deleted = await tx
        .delete(vaults)
        .where(eq(vaults.userId, userId))
        .returning({ userId: vaults.userId });
      return {
        txid: deleted.length > 0 ? await currentTxid(tx) : null,
        files: files.map((file) => file.id),
      };
    });
    await deleteFiles(result.files);
    return c.json({ txid: result.txid });
  })
  .post('/notes', zValidator('json', createVaultNoteSchema), async (c) => {
    const userId = c.get('user')!.id;
    const body = c.req.valid('json');
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const [vault] = await tx
        .select({ userId: vaults.userId })
        .from(vaults)
        .where(eq(vaults.userId, userId));
      if (!vault) return 'no-vault' as const;
      const createdAt = body.createdAt && body.createdAt > now ? now : body.createdAt;
      const inserted = await tx
        .insert(vaultNotes)
        .values({ id: body.id, data: body.data, userId, createdAt, updatedAt: createdAt })
        // Clients replay queued writes, so the note may be here from an earlier try.
        .onConflictDoNothing()
        .returning({ id: vaultNotes.id });
      if (inserted.length > 0) return { txid: await currentTxid(tx) };
      const [mine] = await tx
        .select({ id: vaultNotes.id })
        .from(vaultNotes)
        .where(and(eq(vaultNotes.id, body.id), eq(vaultNotes.userId, userId)));
      return mine ? { txid: null } : ('taken' as const);
    });
    if (result === 'no-vault') return c.json({ error: 'Vault not found' }, 404);
    if (result === 'taken') return c.json({ error: 'Note id is taken' }, 409);
    return c.json(result, result.txid === null ? 200 : 201);
  })
  .patch('/notes/:id', idParam, zValidator('json', updateVaultNoteSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const { data } = c.req.valid('json');
    const txid = await db.transaction(async (tx) => {
      const updated = await tx
        .update(vaultNotes)
        .set({ data })
        .where(and(eq(vaultNotes.id, id), eq(vaultNotes.userId, userId)))
        .returning({ id: vaultNotes.id });
      return updated.length > 0 ? currentTxid(tx) : null;
    });
    if (txid === null) return c.json({ error: 'Note not found' }, 404);
    return c.json({ txid });
  })
  .delete('/notes/:id', idParam, async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const result = await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(vaultNotes)
        .where(and(eq(vaultNotes.id, id), eq(vaultNotes.userId, userId)))
        .returning({ id: vaultNotes.id });
      if (deleted.length === 0) return null;
      await tx.delete(reminders).where(and(eq(reminders.noteId, id), eq(reminders.userId, userId)));
      const files = await tx
        .delete(attachments)
        .where(and(eq(attachments.noteId, id), eq(attachments.userId, userId)))
        .returning({ id: attachments.id });
      return { txid: await currentTxid(tx), files: files.map((file) => file.id) };
    });
    await deleteFiles(result?.files ?? []);
    // Already gone, perhaps deleted by an earlier try of this same queued write.
    return c.json({ txid: result?.txid ?? null });
  });
