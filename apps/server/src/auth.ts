import { BOARD_COLUMNS } from '@catch/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins/bearer';
import { count, eq, sql } from 'drizzle-orm';
import { db } from './db/client';
import * as schema from './db/schema';
import { env, NATIVE_APP_ORIGINS } from './env';

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  basePath: '/api/auth',
  trustedOrigins: [...NATIVE_APP_ORIGINS, ...env.TRUSTED_ORIGINS],
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  rateLimit: { enabled: env.NODE_ENV === 'production' && env.AUTH_RATE_LIMIT },
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
        before: async (user) => {
          const [row] = await db.select({ total: count() }).from(schema.user);
          return { data: { ...user, role: row?.total === 0 ? 'admin' : 'user' } };
        },
        after: async (user) => {
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
  // authenticates with a bearer token instead of cookies.
  plugins: [bearer()],
});

export type AuthSession = typeof auth.$Infer.Session;
