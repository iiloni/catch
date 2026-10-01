import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../env';

const accessSchema = z.object({ userId: z.string(), name: z.string(), expires: z.number().int() });
const sign = (payload: string) =>
  createHmac('sha256', env.BETTER_AUTH_SECRET).update(`backup:${payload}`).digest('base64url');

// A browser saves a download of any size straight to disk only from a plain link, which
// cannot carry the bearer token. Like attachment tickets (ADR 0010), this names one file,
// expires soon, and the server still checks that its user is an admin.
export function issueBackupAccess(userId: string, name: string, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ userId, name, expires: now + 10 * 60 * 1000 }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function readBackupAccess(ticket: string, name: string, now = Date.now()): string | null {
  try {
    const [payload, signature, extra] = ticket.split('.');
    if (!payload || !signature || extra) return null;
    const expected = Buffer.from(sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const parsed = accessSchema.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
    return parsed.success && parsed.data.name === name && parsed.data.expires > now
      ? parsed.data.userId
      : null;
  } catch {
    return null;
  }
}
