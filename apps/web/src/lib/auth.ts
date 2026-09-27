import { createAuthClient } from 'better-auth/react';
import { getServerUrl } from './serverUrl';

const TOKEN_KEY = 'catch-auth-token';

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearAuthToken() {
  localStorage.removeItem(TOKEN_KEY);
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
      if (token) localStorage.setItem(TOKEN_KEY, token);
    },
  },
});
