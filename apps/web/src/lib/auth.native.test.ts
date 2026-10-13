import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Success = { response: Response; request: { url: string }; data: unknown };
const mock = vi.hoisted(() => ({
  success: undefined as ((context: Success) => void) | undefined,
  options: undefined as
    | { baseURL: string; fetchOptions: { auth: { token: () => string } } }
    | undefined,
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('better-auth/react', () => ({
  createAuthClient: (options: {
    baseURL: string;
    fetchOptions: { onSuccess: (context: Success) => void; auth: { token: () => string } };
  }) => {
    mock.success = options.fetchOptions.onSuccess;
    mock.options = options;
    return {};
  },
}));
const alice = { id: 'restored-user', name: 'Alice', email: 'alice@example.com' };
const first = 'https://home.example';
const second = 'https://work.example';
let auth: typeof import('./auth');
async function load(path = '/') {
  window.history.replaceState(null, '', path);
  vi.resetModules();
  auth = await import('./auth');
}
function response(token: string, path = 'sign-in/email') {
  mock.success?.({
    response: new Response(null, { headers: { 'set-auth-token': token } }),
    request: { url: `${mock.options?.baseURL}/api/auth/${path}` },
    data: { user: alice },
  });
}
async function addServer(server: string, token: string) {
  const connections = await import('./nativeAccounts');
  connections.prepareNativeLogin(server);
  await load('/login');
  expect(mock.options?.baseURL).toBe(server);
  expect(mock.options?.fetchOptions.auth.token()).toBe('');
  response(token);
  await load();
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubEnv('DEV', false);
  vi.stubEnv('CATCH_DEV_SERVER_URL', '');
  await load();
});
afterEach(() => vi.unstubAllEnvs());

describe('installed Android server connections', () => {
  it('adopts existing accounts without renaming their offline stores or changing remote IDs', async () => {
    localStorage.setItem('catch-server-url', first);
    localStorage.setItem('catch-accounts', JSON.stringify([{ user: alice, token: 'old-token' }]));
    localStorage.setItem('catch-user', JSON.stringify(alice));
    localStorage.setItem('catch-auth-token', 'old-token');
    localStorage.setItem('catch-import-restored-user', 'pending-import');
    await load();
    expect(auth.getAccountId()).toBe(alice.id);
    expect(auth.getSignedInUser()).toEqual(alice);
    expect(auth.getAuthToken()).toBe('old-token');
    expect(auth.getAccounts()).toEqual([
      { id: alice.id, server: first, user: alice, token: 'old-token' },
    ]);
    expect(localStorage.getItem('catch-import-restored-user')).toBe('pending-import');
    expect(localStorage.getItem('catch-auth-token')).toBeNull();
    await load();
    expect(auth.getAccountId()).toBe(alice.id);
    expect(auth.getAuthToken()).toBe('old-token');
  });

  it('keeps cloned user IDs, tokens and storage identities separate', async () => {
    await addServer(first, 'home-token');
    const home = auth.getAccounts()[0];
    if (!home) throw new Error('Missing home account');
    const oldPage = auth;
    const oldServer = await import('./serverUrl');
    await addServer(second, 'work-token');
    const work = auth.getAccounts()[1];
    if (!work) throw new Error('Missing work account');
    expect(auth.accountId(home)).not.toBe(auth.accountId(work));
    expect(auth.getSignedInUser()?.id).toBe(alice.id);
    expect(auth.getAuthToken()).toBe('work-token');
    expect(oldPage.getAuthToken()).toBe('home-token');
    expect(oldServer.getServerUrl()).toBe(first);
    expect((await import('./storageIdentity')).currentAccountId()).toBe(auth.accountId(work));
    auth.activateAccount(auth.accountId(home));
    // The old page retains its own server and token until the reload.
    expect(auth.getAuthToken()).toBe('work-token');
    expect((await import('./serverUrl')).getServerUrl()).toBe(second);
    await load();
    expect(auth.getAuthToken()).toBe('home-token');
    expect((await import('./serverUrl')).getServerUrl()).toBe(first);
  });

  it('keeps the previous connection when adding a server is cancelled', async () => {
    await addServer(first, 'home-token');
    const home = auth.getAccounts()[0];
    if (!home) throw new Error('Missing home account');
    (await import('./nativeAccounts')).prepareNativeLogin(second);
    await load('/login');
    expect(auth.getSignedInUser()).toBeNull();
    expect(auth.getAccounts()).toHaveLength(1);
    auth.activateAccount(auth.accountId(home));
    await load();
    expect(auth.getAuthToken()).toBe('home-token');
    expect((await import('./serverUrl')).getServerUrl()).toBe(first);
  });

  it('reauthenticates the same server account under its existing storage identity', async () => {
    await addServer(first, 'home-token');
    const id = auth.getAccountId();
    auth.clearAuthToken();
    await addServer(first, 'new-token');
    expect(auth.getAccounts()).toHaveLength(1);
    expect(auth.getAccountId()).toBe(id);
    expect(auth.getAuthToken()).toBe('new-token');
  });

  it('removes only the selected account and rejects late session responses', async () => {
    await addServer(first, 'home-token');
    await addServer(second, 'work-token');
    const home = auth.getAccounts()[0];
    if (!home) throw new Error('Missing home account');
    auth.forgetAccount(auth.accountId(home));
    expect(auth.getAuthToken()).toBe('work-token');
    auth.clearAuthToken();
    response('late-token', 'get-session');
    expect(auth.getAccounts()).toEqual([]);
    expect(auth.getAuthToken()).toBeNull();
  });

  it('routes a cold notification to its account and server before constructing auth', async () => {
    await addServer(first, 'home-token');
    await addServer(second, 'work-token');
    const home = auth.getAccounts()[0];
    if (!home) throw new Error('Missing home account');
    await load(`/?note=restored-note&account=${auth.accountId(home)}`);
    expect(auth.getAuthToken()).toBe('home-token');
    expect(mock.options?.baseURL).toBe(first);
    expect(window.location.search).toBe('?note=restored-note');
  });

  it('refuses a damaged registry without overwriting it or adopting another server', async () => {
    localStorage.setItem('catch-server-accounts', '{broken');
    localStorage.setItem('catch-server-url', second);
    await expect(load()).rejects.toThrow('Could not read saved server connections');
    expect(localStorage.getItem('catch-server-accounts')).toBe('{broken');
  });
});
