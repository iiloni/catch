import { randomBytes } from 'node:crypto';
import { adminUserSchema, listUsersSchema, updateUserRoleSchema } from '@catch/shared';
import { zValidator } from '@hono/zod-validator';
import { and, asc, count, eq, ilike, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { deleteFiles } from '../attachments/files';
import { auth } from '../auth';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { account, attachments, session, user } from '../db/schema';
import { requireAdmin } from '../lib/requireAdmin';
import { backupRoutes } from './backups';

const userColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt,
};

const idParam = zValidator('param', z.object({ id: z.string().min(1).max(128) }));
type AdminTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockAdminMutation(tx: AdminTransaction, actorId: string) {
  // An actor deleted or demoted by another request must lose permission before their edit.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('catch-admin-roles'))`);
  const [actor] = await tx.select({ role: user.role }).from(user).where(eq(user.id, actorId));
  return actor?.role === 'admin';
}

export const adminRoutes = new Hono<AppEnv>()
  .use(requireAdmin)
  .use(async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  })
  .get('/users', zValidator('query', listUsersSchema), async (c) => {
    const { search, offset, limit } = c.req.valid('query');
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    const filter = search ? or(ilike(user.name, pattern), ilike(user.email, pattern)) : undefined;
    // The admin directory is intentionally server-wide (ADR 0011).
    const [rows, totals] = await Promise.all([
      db
        .select(userColumns)
        .from(user)
        .where(filter)
        .orderBy(asc(user.createdAt), asc(user.id))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(user).where(filter),
    ]);
    c.header('Cache-Control', 'no-store');
    return c.json({
      users: rows.map((row) =>
        adminUserSchema.parse({
          ...row,
          createdAt: row.createdAt.toISOString(),
          lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
        }),
      ),
      total: totals[0]?.total ?? 0,
    });
  })
  .patch('/users/:id/role', idParam, zValidator('json', updateUserRoleSchema), async (c) => {
    const actorId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const { role } = c.req.valid('json');
    if (id === actorId) return c.json({ error: 'You cannot change your own role' }, 409);
    const result = await db.transaction(async (tx) => {
      if (!(await lockAdminMutation(tx, actorId))) return 'forbidden';
      const [updated] = await tx
        .update(user)
        .set({ role })
        .where(eq(user.id, id))
        .returning(userColumns);
      return updated ?? null;
    });
    if (result === 'forbidden') return c.json({ error: 'Admin access required' }, 403);
    if (!result) return c.json({ error: 'User not found' }, 404);
    return c.json(
      adminUserSchema.parse({
        ...result,
        createdAt: result.createdAt.toISOString(),
        lastLoginAt: result.lastLoginAt?.toISOString() ?? null,
      }),
    );
  })
  .post('/users/:id/reset-password', idParam, async (c) => {
    const actorId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    if (id === actorId)
      return c.json({ error: 'Change your own password in Account settings' }, 409);
    const temporaryPassword = randomBytes(18).toString('base64url');
    const password = await (await auth.$context).password.hash(temporaryPassword);
    const result = await db.transaction(async (tx) => {
      if (!(await lockAdminMutation(tx, actorId))) return 'forbidden';
      const [target] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, id))
        .for('update');
      if (!target) return 'missing';
      const changed = await tx
        .update(account)
        .set({ password })
        .where(and(eq(account.userId, id), eq(account.providerId, 'credential')))
        .returning({ id: account.id });
      if (!changed.length) return 'no-password';
      await tx.delete(session).where(eq(session.userId, id));
      return 'reset';
    });
    if (result === 'forbidden') return c.json({ error: 'Admin access required' }, 403);
    if (result === 'missing') return c.json({ error: 'User not found' }, 404);
    if (result === 'no-password')
      return c.json({ error: 'This account does not use a password' }, 409);
    return c.json({ temporaryPassword });
  })
  .delete('/users/:id', idParam, async (c) => {
    const actorId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    if (id === actorId) return c.json({ error: 'You cannot delete your own account here' }, 409);
    const result = await db.transaction(async (tx) => {
      if (!(await lockAdminMutation(tx, actorId))) return 'forbidden';
      // Lock the owner before collecting files so new dependent rows cannot miss cleanup.
      const [target] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, id))
        .for('update');
      if (!target) return null;
      const files = await tx
        .select({ id: attachments.id })
        .from(attachments)
        .where(eq(attachments.userId, id));
      await tx.delete(user).where(eq(user.id, id));
      return files.map((file) => file.id);
    });
    if (result === 'forbidden') return c.json({ error: 'Admin access required' }, 403);
    if (!result) return c.json({ error: 'User not found' }, 404);
    await deleteFiles(result);
    return c.json({ ok: true });
  })
  .route('/backups', backupRoutes);
