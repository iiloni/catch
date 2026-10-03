import { createInviteSchema, type Invite } from '@catch/shared';
import { zValidator } from '@hono/zod-validator';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { invites, user } from '../db/schema';
import { newInvite } from '../lib/invites';

const columns = {
  id: invites.id,
  label: invites.label,
  createdAt: invites.createdAt,
  expiresAt: invites.expiresAt,
  usedAt: invites.usedAt,
  usedByName: user.name,
  usedByEmail: user.email,
};

type Row = {
  id: string;
  label: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  usedByName: string | null;
  usedByEmail: string | null;
};

const describe = (row: Row): Invite => ({
  id: row.id,
  label: row.label,
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
  usedAt: row.usedAt?.toISOString() ?? null,
  usedBy: row.usedByEmail === null ? null : { name: row.usedByName ?? '', email: row.usedByEmail },
});

/**
 * Invites, mounted in the admin routes behind their guard (ADR 0011). Like the user
 * directory they are server-wide: any admin sees and revokes every invite.
 */
export const inviteRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const rows = await db
      .select(columns)
      .from(invites)
      .leftJoin(user, eq(user.id, invites.usedBy))
      .orderBy(desc(invites.createdAt), desc(invites.id))
      .limit(200);
    return c.json({ invites: rows.map(describe) });
  })
  .post('/', zValidator('json', createInviteSchema), async (c) => {
    const { token, tokenHash, expiresAt } = newInvite();
    const [row] = await db
      .insert(invites)
      .values({
        tokenHash,
        expiresAt,
        label: c.req.valid('json').label,
        createdBy: c.get('user')!.id,
      })
      .returning();
    if (!row) throw new Error('The invite was not saved');
    return c.json(
      { invite: describe({ ...row, usedByName: null, usedByEmail: null }), token },
      201,
    );
  })
  .delete('/:id', zValidator('param', z.object({ id: z.uuid() })), async (c) => {
    // Removing one that was used only clears it from the list: the account it made stays.
    await db.delete(invites).where(eq(invites.id, c.req.valid('param').id));
    return c.json({ ok: true });
  });
