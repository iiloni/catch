import { Capacitor } from '@capacitor/core';
import { createAuthClient } from 'better-auth/react';
import { z } from 'zod';
import { getServerUrl } from './serverUrl';

const TOKEN_KEY = 'catch-auth-token';
const USER_KEY = 'catch-user';

function sessionKey(key: string) {
  // Bundled dev apps share https://localhost across worktrees; their servers do not.
  return Capacitor.isNativePlatform() && import.meta.env.CATCH_DEV_SERVER_URL
    ? `${key}:${getServerUrl()}`
    : key;
}

export function getAuthToken(): string | null {
  return localStorage.getItem(sessionKey(TOKEN_KEY));
}

const signedInUserSchema = z.object({ id: z.string().min(1), name: z.string(), email: z.string() });

export type SignedInUser = z.infer<typeof signedInUserSchema>;

/**
 * The user the saved token belongs to, remembered from the last session the server returned.
 * Offline there is no session to fetch, and the app still needs to know whose notes to open.
 */
export function getSignedInUser(): SignedInUser | null {
  try {
    const parsed = signedInUserSchema.safeParse(
      JSON.parse(localStorage.getItem(sessionKey(USER_KEY)) ?? ''),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function rememberUser(value: unknown) {
  const parsed = signedInUserSchema.safeParse(value);
  if (!parsed.success) return;
  const { id, name, email } = parsed.data;
  localStorage.setItem(sessionKey(USER_KEY), JSON.stringify({ id, name, email }));
}

export function clearAuthToken() {
  localStorage.removeItem(sessionKey(TOKEN_KEY));
  localStorage.removeItem(sessionKey(USER_KEY));
}

/**
 * Every client authenticates with a bearer token rather than cookies, so the
 * web app and the Android app (a different origin) share one code path.
 */
export const authClient = createAuthClient({
  baseURL: getServerUrl(),
  basePath: '/api/auth',
  fetchOptions: {
    auth: { type: 'Bearer', token: () => getAuthToken() ?? '' },
    onSuccess: (context) => {
      const token = context.response.headers.get('set-auth-token');
      if (token) localStorage.setItem(sessionKey(TOKEN_KEY), token);
      // Sign-in, sign-up and session responses carry the signed-in user.
      const data: unknown = context.data;
      if (
        /\/(sign-in|sign-up)\/|\/get-session(\?|$)/.test(String(context.request.url)) &&
        data &&
        typeof data === 'object' &&
        'user' in data
      ) {
        rememberUser(data.user);
      }
    },
  },
});

/**
 * The signed-in user, asking the server when this device has a token but has not remembered
 * the user yet (a session from before the app remembered them). Null when signed out, or
 * when that lookup fails offline.
 */
export async function resolveSignedInUser(): Promise<SignedInUser | null> {
  if (!getAuthToken()) return null;
  const remembered = getSignedInUser();
  if (remembered) return remembered;
  try {
    await authClient.getSession();
  } catch {
    // Offline: carry on without knowing the user.
  }
  return getSignedInUser();
}
