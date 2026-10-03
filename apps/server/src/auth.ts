import { BOARD_COLUMNS, INVITE_HEADER } from '@catch/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { bearer } from 'better-auth/plugins/bearer';
import { count, eq, sql } from 'drizzle-orm';
import { db } from './db/client';
import * as schema from './db/schema';
import { env, NATIVE_APP_ORIGINS } from './env';
import { CLIENT_IP_HEADER } from './lib/clientIp';
import { claimInvite, recordInvitedUser } from './lib/invites';

type HookContext = { request?: Request; headers?: Headers } | null | undefined;
const inviteToken = (context: HookContext) =>
  context?.request?.headers.get(INVITE_HEADER) ?? context?.headers?.get(INVITE_HEADER) ?? null;

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  basePath: '/api/auth',
  trustedOrigins: [...NATIVE_APP_ORIGINS, ...env.TRUSTED_ORIGINS],
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  rateLimit: { enabled: env.NODE_ENV === 'production' && env.AUTH_RATE_LIMIT },
  // The rate limit goes by the address `app.ts` reads from the connection, never by a
  // forwarding header as the client sent it.
  advanced: { ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  user: {
    additionalFields: {
      role: { type: 'string', defaultValue: 'user', input: false },
    },
  },
  databaseHooks: {
    session: {
      create: {
        after: async (session, context) => {
          if (context?.path === '/change-password') return;
          // Refreshes update the session instead; only a new sign-in advances this timestamp.
          await db
            .update(schema.user)
            .set({
              lastLoginAt: sql`greatest(${schema.user.lastLoginAt}, ${session.createdAt.toISOString()}::timestamptz)`,
            })
            .where(eq(schema.user.id, session.userId));
        },
      },
    },
    user: {
      create: {
        // The first account on a self-hosted instance becomes its admin.
        before: async (user, context) => {
          const [row] = await db.select({ total: count() }).from(schema.user);
          const first = row?.total === 0;
          const invite = inviteToken(context);
          // An invite is one account's way past closed registration. A link that is offered
          // has to be good even when registration is open, so it is never quietly reusable.
          if (!first && invite !== null) {
            if (!(await claimInvite(invite))) {
              throw new APIError('FORBIDDEN', {
                message: 'This invite has been used or has expired. Ask the admin for a new one.',
              });
            }
          } else if (!first && env.REGISTRATION === 'closed') {
            throw new APIError('FORBIDDEN', {
              message: 'This server is not accepting new accounts. Ask its admin for an invite.',
            });
          }
          return { data: { ...user, role: first ? 'admin' : 'user' } };
        },
        after: async (user, context) => {
          const invite = inviteToken(context);
          if (invite !== null) await recordInvitedUser(invite, user.id);
          await db.insert(schema.boardColumns).values(
            BOARD_COLUMNS.map((column, index) => ({
              ...column,
              userId: user.id,
              position: `a${index}`,
            })),
          );
        },
      },
    },
  },
  // The Android app runs on a different origin than the server, so it
  // authenticates with a bearer token instead of cookies. Only the signed token a sign-in
  // returns is accepted: the bare one in the session table (and so in a database dump)
  // signs nobody in.
  plugins: [bearer({ requireSignature: true })],
});

export type AuthSession = typeof auth.$Infer.Session;
