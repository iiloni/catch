import { z } from 'zod';

export const signedInUserSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  email: z.string(),
});
const sessionSchema = z.object({ user: signedInUserSchema, token: z.string().min(1) });
const identitySchema = z.object({
  id: z.string().min(1),
  server: z.string().url(),
  userId: z.string().min(1),
});
const nativeAccountSchema = sessionSchema.extend({
  id: z.string().min(1),
  server: z.string().url(),
});
const storeSchema = z.object({
  version: z.literal(1),
  servers: z.array(z.string().url()),
  identities: z.array(identitySchema),
  accounts: z.array(nativeAccountSchema),
  active: z.string().nullable(),
});
type NativeStore = z.infer<typeof storeSchema>;
export type NativeAccount = z.infer<typeof nativeAccountSchema>;

const KEY = 'catch-server-accounts';
const TAB = 'catch-tab-account';
const LOGIN = 'catch-login-server';

function parse<T extends z.ZodType>(key: string, schema: T): z.infer<T> | null {
  const value = localStorage.getItem(key);
  if (!value) return null;
  try {
    return schema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}

function write(store: NativeStore) {
  localStorage.setItem(KEY, JSON.stringify(store));
}

function clearLegacySessions() {
  for (const key of ['catch-accounts', 'catch-user', 'catch-auth-token', 'catch-active-account'])
    localStorage.removeItem(key);
}

/** Adopt the old stores in place: their names and queued payloads never need moving. */
function read(): NativeStore {
  const stored = parse(KEY, storeSchema);
  if (stored) {
    // Also finishes adoption interrupted after the registry write.
    clearLegacySessions();
    return stored;
  }
  // A damaged registry must never reassign existing databases to a new server.
  if (localStorage.getItem(KEY)) throw new Error('Could not read saved server connections.');
  const server = localStorage.getItem('catch-server-url');
  const store: NativeStore = {
    version: 1,
    servers: [],
    identities: [],
    accounts: [],
    active: null,
  };
  if (!server) return store;
  const origin = new URL(server).origin;
  let sessions = parse('catch-accounts', z.array(sessionSchema)) ?? [];
  const user = parse('catch-user', signedInUserSchema);
  const token = localStorage.getItem('catch-auth-token');
  const marked = localStorage.getItem('catch-active-account');
  if (marked && (!token || user?.id !== marked))
    sessions = sessions.filter((session) => session.user.id !== marked);
  if (user && token) {
    sessions = [...sessions.filter((session) => session.user.id !== user.id), { user, token }];
    store.active = user.id;
  }
  store.servers = [origin];
  store.accounts = sessions.map((session) => ({ ...session, id: session.user.id, server: origin }));
  store.identities = store.accounts.map((account) => ({
    id: account.id,
    server: origin,
    userId: account.user.id,
  }));
  // One atomic registry write is the migration marker; interruption cannot half-move data.
  write(store);
  // An older APK cannot interpret multiple servers. Leave it signed out rather than let
  // it open another server's data under a bare user ID after a downgrade.
  clearLegacySessions();
  return store;
}

export function nativeAccounts() {
  return read().accounts;
}

export function nativeServers() {
  return read().servers;
}

export function prepareNativeLogin(server: string) {
  const origin = new URL(server).origin;
  const store = read();
  if (!store.servers.includes(origin)) {
    store.servers.push(origin);
    write(store);
  }
  sessionStorage.setItem(LOGIN, origin);
}

/** Settle server and session before auth, collections or the outbox are constructed. */
export function nativePage(): { account: NativeAccount | null; server: string } {
  const store = read();
  const login = sessionStorage.getItem(LOGIN);
  if (window.location.pathname === '/login' && login) return { account: null, server: login };
  const linked = new URL(window.location.href).searchParams.get('account');
  const id = linked ?? sessionStorage.getItem(TAB) ?? store.active;
  const account =
    store.accounts.find((account) => account.id === id) ??
    (linked ? null : store.accounts.find((account) => account.id === store.active)) ??
    null;
  if (account) sessionStorage.setItem(TAB, account.id);
  return { account, server: account?.server ?? localStorage.getItem('catch-server-url') ?? '' };
}

export function saveNativeAccount(
  session: z.infer<typeof sessionSchema>,
  server: string,
  activate: boolean,
): NativeAccount {
  const store = read();
  let identity = store.identities.find(
    (entry) => entry.server === server && entry.userId === session.user.id,
  );
  if (!identity) {
    identity = { id: `n-${crypto.randomUUID()}`, server, userId: session.user.id };
    store.identities.push(identity);
  }
  const account = { ...session, id: identity.id, server };
  const index = store.accounts.findIndex((other) => other.id === account.id);
  if (index < 0) store.accounts.push(account);
  else store.accounts[index] = account;
  if (!store.servers.includes(server)) store.servers.push(server);
  if (activate) store.active = account.id;
  write(store);
  if (activate) {
    sessionStorage.setItem(TAB, account.id);
    sessionStorage.removeItem(LOGIN);
  }
  return account;
}

export function activateNativeAccount(id: string) {
  const store = read();
  if (!store.accounts.some((account) => account.id === id)) return false;
  store.active = id;
  write(store);
  sessionStorage.setItem(TAB, id);
  sessionStorage.removeItem(LOGIN);
  return true;
}

export function forgetNativeAccount(id: string) {
  const store = read();
  store.accounts = store.accounts.filter((account) => account.id !== id);
  if (store.active === id) store.active = null;
  write(store);
}
