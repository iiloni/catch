import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { user } from '../db/schema';

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const signedIn = c.get('user');
  if (!signedIn) return c.json({ error: 'Unauthorized' }, 401);
  // Roles can change while a session is open; the database is the authority.
  const [current] = await db.select({ role: user.role }).from(user).where(eq(user.id, signedIn.id));
  if (current?.role !== 'admin') return c.json({ error: 'Admin access required' }, 403);
  await next();
});
