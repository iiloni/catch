import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../env';

const accessSchema = z.object({ userId: z.string(), id: z.uuid(), expires: z.number().int() });
const sign = (payload: string) =>
  createHmac('sha256', env.BETTER_AUTH_SECRET).update(`attachment:${payload}`).digest('base64url');

// Narrow, expiring access lets native <img>/<video>/<audio> make range requests without
// putting the account's bearer token in a URL or making personal files public.
export function issueAccess(userId: string, id: string, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ userId, id, expires: now + 60 * 60 * 1000 }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function readAccess(ticket: string, id: string, now = Date.now()): string | null {
  try {
    const [payload, signature, extra] = ticket.split('.');
    if (!payload || !signature || extra) return null;
    const expected = Buffer.from(sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const parsed = accessSchema.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
    return parsed.success && parsed.data.id === id && parsed.data.expires > now
      ? parsed.data.userId
      : null;
  } catch {
    return null;
  }
}
