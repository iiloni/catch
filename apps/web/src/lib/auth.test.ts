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

let auth: typeof import('./auth');
/** Loads the page again: a page keeps the account it was loaded for until then. */
async function load() {
  vi.resetModules();
  auth = await import('./auth');
}

const user = { id: 'first-user', name: 'Test', email: 'test@example.com' };
const other = { id: 'second-user', name: 'Other', email: 'other@example.com' };
function respond(path: string, token: string | null, data: unknown) {
  mocks.success?.({
    response: new Response(null, { headers: token ? { 'set-auth-token': token } : {} }),
    request: { url: `${mocks.server()}/api/auth/${path}` },
    data,
  });
}
const signIn = (token: string, signedInUser = user) =>
  respond('sign-in/email', token, { user: signedInUser });

/** Another tab: it shares the device's storage and has a session of its own. */
async function openTab() {
  sessionStorage.clear();
  await load();
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  mocks.native.mockReturnValue(true);
  mocks.server.mockReturnValue('http://llm:24085');
  vi.stubEnv('CATCH_DEV_SERVER_URL', 'http://llm:24085');
  await load();
});
afterEach(() => vi.unstubAllEnvs());

describe('bundled development sessions', () => {
  it('does not reuse an unscoped session from another server or remove its data', async () => {
    localStorage.setItem('catch-auth-token', 'legacy-token');
    localStorage.setItem('catch-user', JSON.stringify(user));
    await load();
    expect(auth.getAuthToken()).toBeNull();
    expect(auth.getSignedInUser()).toBeNull();
    signIn('current-token');
    auth.clearAuthToken();
    expect(auth.getAuthToken()).toBeNull();
    expect(localStorage.getItem('catch-auth-token')).toBe('legacy-token');
    expect(localStorage.getItem('catch-user')).toBe(JSON.stringify(user));
  });

  it('keeps sessions separate and restores the right one when switching worktrees', async () => {
    signIn('first-token');
    mocks.server.mockReturnValue('http://llm:24086');
    await load();
    expect(auth.getAuthToken()).toBeNull();
    expect(auth.getSignedInUser()).toBeNull();
    signIn('second-token', other);
    expect(auth.getSignedInUser()?.id).toBe('second-user');
    auth.clearAuthToken();
    mocks.server.mockReturnValue('http://llm:24085');
    await load();
    expect(auth.getAuthToken()).toBe('first-token');
    expect(auth.getSignedInUser()).toEqual(user);
  });

  it.each(['web', 'native release', 'native live reload'])(
    'keeps the existing storage keys for %s',
    (platform) => {
      if (platform === 'web') mocks.native.mockReturnValue(false);
      else vi.stubEnv('CATCH_DEV_SERVER_URL', '');
      signIn('ordinary-token');
      expect(localStorage.getItem('catch-auth-token')).toBe('ordinary-token');
      expect(auth.getSignedInUser()).toEqual(user);
      auth.clearAuthToken();
      expect(localStorage.getItem('catch-user')).toBeNull();
    },
  );
});

describe('several accounts on one device', () => {
  beforeEach(() => mocks.native.mockReturnValue(false));

  /** Two accounts signed in one after the other, on a page loaded for the second. */
  async function signInBoth() {
    signIn('first-token');
    await load();
    signIn('second-token', other);
    await load();
  }

  it('keeps the earlier account signed in when another signs in', async () => {
    await signInBoth();
    expect(auth.getSignedInUser()).toEqual(other);
    expect(auth.getAuthToken()).toBe('second-token');
    expect(auth.getAccounts()).toEqual([
      { user, token: 'first-token' },
      { user: other, token: 'second-token' },
    ]);
  });

  it('keeps sending the first account’s token until the page loads for the one added', async () => {
    signIn('first-token');
    await load();
    signIn('second-token', other);
    // The first account's collections and outbox are still running on this page.
    expect(auth.getAuthToken()).toBe('first-token');
    expect(auth.getSignedInUser()).toEqual(user);
    expect(localStorage.getItem('catch-auth-token')).toBe('second-token');
    await load();
    expect(auth.getAuthToken()).toBe('second-token');
  });

  it('lists a session saved before accounts were listed', async () => {
    localStorage.setItem('catch-auth-token', 'legacy-token');
    localStorage.setItem('catch-user', JSON.stringify(user));
    await load();
    expect(auth.getAccounts()).toEqual([{ user, token: 'legacy-token' }]);
    signIn('second-token', other);
    expect(auth.getAccounts().map((account) => account.token)).toEqual([
      'legacy-token',
      'second-token',
    ]);
  });

  it('learns the user of a session saved before users were remembered', async () => {
    localStorage.setItem('catch-auth-token', 'legacy-token');
    await load();
    expect(auth.getAuthToken()).toBe('legacy-token');
    respond('get-session', null, { user });
    expect(auth.getSignedInUser()).toEqual(user);
    expect(auth.getAccounts()).toEqual([{ user, token: 'legacy-token' }]);
  });

  it('replaces the session of an account that signs in again', async () => {
    await signInBoth();
    signIn('newer-token');
    expect(auth.getAccounts()).toEqual([
      { user, token: 'newer-token' },
      { user: other, token: 'second-token' },
    ]);
  });

  it('keeps using the account the page loaded for until it loads again', async () => {
    await signInBoth();
    expect(auth.activateAccount(user.id)).toBe(true);
    expect(localStorage.getItem('catch-auth-token')).toBe('first-token');
    expect(auth.getAuthToken()).toBe('second-token');
    expect(auth.getSignedInUser()).toEqual(other);
    await load();
    expect(auth.getSignedInUser()).toEqual(user);
  });

  it('keeps a tab on its account, across reloads, while another tab switches', async () => {
    await signInBoth();
    const tab = sessionStorage.getItem('catch-tab-account');
    // The other tab starts as the account last used, then switches to the first.
    await openTab();
    expect(auth.getSignedInUser()).toEqual(other);
    auth.activateAccount(user.id);
    await load();
    expect(auth.getSignedInUser()).toEqual(user);
    // Back in the first tab, which reloads.
    sessionStorage.clear();
    sessionStorage.setItem('catch-tab-account', tab ?? '');
    await load();
    expect(auth.getSignedInUser()).toEqual(other);
    expect(auth.getAuthToken()).toBe('second-token');
    expect(auth.pageAccountGone()).toBe(false);
  });

  it('knows when its account was signed out in another tab, and starts over after', async () => {
    await signInBoth();
    // As the other tab would, with this page still open.
    const accounts = auth.getAccounts().filter((account) => account.user.id !== other.id);
    localStorage.setItem('catch-accounts', JSON.stringify(accounts));
    localStorage.setItem('catch-auth-token', 'first-token');
    localStorage.setItem('catch-user', JSON.stringify(user));
    localStorage.setItem('catch-active-account', user.id);
    expect(auth.pageAccountGone()).toBe(true);
    expect(auth.getAuthToken()).toBeNull();
    await load();
    expect(auth.getSignedInUser()).toEqual(user);
    expect(auth.pageAccountGone()).toBe(false);
  });

  it('gives a new token to the account the page uses, not the one the device switched to', async () => {
    await signInBoth();
    auth.activateAccount(user.id);
    respond('change-password', 'changed-token', {});
    expect(localStorage.getItem('catch-auth-token')).toBe('first-token');
    expect(auth.getAccounts()).toEqual([
      { user, token: 'first-token' },
      { user: other, token: 'changed-token' },
    ]);
  });

  it('forgets one account and leaves the rest', async () => {
    await signInBoth();
    auth.forgetAccount(user.id);
    expect(auth.getAccounts()).toEqual([{ user: other, token: 'second-token' }]);
    expect(auth.getAuthToken()).toBe('second-token');
    auth.clearAuthToken();
    expect(auth.getAccounts()).toEqual([]);
    expect(auth.getAuthToken()).toBeNull();
    expect(localStorage.getItem('catch-user')).toBeNull();
  });

  it('has no session once its account signs out, though the device moves to another', async () => {
    await signInBoth();
    auth.clearAuthToken();
    auth.activateAccount(user.id);
    expect(auth.getAuthToken()).toBeNull();
    expect(auth.getSignedInUser()).toBeNull();
    // An answer that was already on its way must not sign the account back in.
    respond('get-session', null, { user: other });
    expect(auth.getAccounts()).toEqual([{ user, token: 'first-token' }]);
    expect(localStorage.getItem('catch-auth-token')).toBe('first-token');
    expect(JSON.parse(localStorage.getItem('catch-user') ?? '')).toEqual(user);
  });

  it('does not sign a removed account back in when a late response arrives', () => {
    signIn('first-token');
    localStorage.clear();
    respond('get-session', null, { user });
    expect(auth.getAccounts()).toEqual([]);
  });

  it('drops an account that an older build signed out', async () => {
    await signInBoth();
    // The older build knows only the session in use.
    localStorage.removeItem('catch-auth-token');
    localStorage.removeItem('catch-user');
    await load();
    expect(auth.getAccounts()).toEqual([{ user, token: 'first-token' }]);
    expect(auth.getAuthToken()).toBeNull();
  });

  it('drops an account that an older build replaced with another', async () => {
    await signInBoth();
    const third = { id: 'third-user', name: '', email: 'third@example.com' };
    localStorage.setItem('catch-auth-token', 'third-token');
    localStorage.setItem('catch-user', JSON.stringify(third));
    await load();
    expect(auth.getAccounts()).toEqual([
      { user, token: 'first-token' },
      { user: third, token: 'third-token' },
    ]);
  });

  it('loads as the account a notification names', async () => {
    await signInBoth();
    window.history.replaceState(null, '', `/?note=abc&account=${user.id}`);
    await load();
    expect(auth.getSignedInUser()).toEqual(user);
    expect(auth.getAccounts()).toHaveLength(2);
    expect(window.location.search).toBe('?note=abc');
    // An account that is not signed in here changes nothing, and its note is not opened.
    window.history.replaceState(null, '', '/?note=abc&account=nobody');
    await load();
    expect(auth.getSignedInUser()).toEqual(user);
    expect(window.location.search).toBe('');
  });

  it('refuses to switch to an account that is not signed in', () => {
    signIn('first-token');
    expect(auth.activateAccount('nobody')).toBe(false);
    expect(auth.getAuthToken()).toBe('first-token');
  });
});
