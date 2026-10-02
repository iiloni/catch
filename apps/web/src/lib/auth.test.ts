import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SuccessContext = { response: Response; request: { url: string }; data: unknown };
const mocks = vi.hoisted(() => ({
  native: vi.fn(() => true),
  server: vi.fn(() => 'http://llm:24085'),
  success: undefined as ((context: SuccessContext) => void) | undefined,
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: mocks.native } }));
vi.mock('./serverUrl', () => ({ getServerUrl: mocks.server }));
vi.mock('better-auth/react', () => ({
  createAuthClient: (options: {
    fetchOptions: { onSuccess: (context: SuccessContext) => void };
  }) => {
    mocks.success = options.fetchOptions.onSuccess;
    return {};
  },
}));

import { clearAuthToken, getAuthToken, getSignedInUser } from './auth';

const user = { id: 'first-user', name: 'Test', email: 'test@example.com' };
function signIn(token: string, signedInUser = user) {
  mocks.success?.({
    response: new Response(null, { headers: { 'set-auth-token': token } }),
    request: { url: `${mocks.server()}/api/auth/sign-in/email` },
    data: { user: signedInUser },
  });
}

beforeEach(() => {
  localStorage.clear();
  mocks.native.mockReturnValue(true);
  mocks.server.mockReturnValue('http://llm:24085');
  vi.stubEnv('CATCH_DEV_SERVER_URL', 'http://llm:24085');
});
afterEach(() => vi.unstubAllEnvs());

describe('bundled development sessions', () => {
  it('does not reuse an unscoped session from another server or remove its data', () => {
    localStorage.setItem('catch-auth-token', 'legacy-token');
    localStorage.setItem('catch-user', JSON.stringify(user));
    expect(getAuthToken()).toBeNull();
    expect(getSignedInUser()).toBeNull();
    signIn('current-token');
    clearAuthToken();
    expect(getAuthToken()).toBeNull();
    expect(localStorage.getItem('catch-auth-token')).toBe('legacy-token');
    expect(localStorage.getItem('catch-user')).toBe(JSON.stringify(user));
  });

  it('keeps sessions separate and restores the right one when switching worktrees', () => {
    signIn('first-token');
    mocks.server.mockReturnValue('http://llm:24086');
    expect(getAuthToken()).toBeNull();
    expect(getSignedInUser()).toBeNull();
    signIn('second-token', { ...user, id: 'second-user' });
    expect(getSignedInUser()?.id).toBe('second-user');
    clearAuthToken();
    mocks.server.mockReturnValue('http://llm:24085');
    expect(getAuthToken()).toBe('first-token');
    expect(getSignedInUser()).toEqual(user);
  });

  it.each(['web', 'native release', 'native live reload'])(
    'keeps the existing storage keys for %s',
    (platform) => {
      if (platform === 'web') mocks.native.mockReturnValue(false);
      else vi.stubEnv('CATCH_DEV_SERVER_URL', '');
      signIn('ordinary-token');
      expect(localStorage.getItem('catch-auth-token')).toBe('ordinary-token');
      expect(getSignedInUser()).toEqual(user);
      clearAuthToken();
      expect(localStorage.getItem('catch-user')).toBeNull();
    },
  );
});
