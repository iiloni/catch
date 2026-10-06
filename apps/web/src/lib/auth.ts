import { Capacitor } from '@capacitor/core';
import { createAuthClient } from 'better-auth/react';
import { z } from 'zod';
import { getServerUrl } from './serverUrl';

// The session in use, kept under the keys it had before a device could hold several.
const TOKEN_KEY = 'catch-auth-token';
const USER_KEY = 'catch-user';
// Every session on this device, the one in use among them.
const ACCOUNTS_KEY = 'catch-accounts';
// Whose session this build last put in use. A build from before the list changes the session
// without knowing either, which is how the list learns of it.
const ACTIVE_KEY = 'catch-active-account';
/** Set in the session when the next page load is a change of account, to say so once. */
export const SWITCHED_KEY = 'catch-account-switched';

function sessionKey(key: string) {
  // Bundled dev apps share https://localhost across worktrees; their servers do not.
  return Capacitor.isNativePlatform() && import.meta.env.CATCH_DEV_SERVER_URL
    ? `${key}:${getServerUrl()}`
    : key;
}

const signedInUserSchema = z.object({ id: z.string().min(1), name: z.string(), email: z.string() });
const accountSchema = z.object({ user: signedInUserSchema, token: z.string().min(1) });

export type SignedInUser = z.infer<typeof signedInUserSchema>;
/** An account signed in on this device, with the bearer token of its session. */
export type Account = z.infer<typeof accountSchema>;

function read<T extends z.ZodType>(key: string, schema: T): z.infer<T> | null {
  try {
    const parsed = schema.safeParse(JSON.parse(localStorage.getItem(sessionKey(key)) ?? ''));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const activeToken = () => localStorage.getItem(sessionKey(TOKEN_KEY));
const activeUser = () => read(USER_KEY, signedInUserSchema);

/**
 * Each tab shows one account and keeps it across reloads, so tabs can show different ones
 * side by side (ADR 0019). The session in use on the device is only where a new tab starts.
 */
const TAB_KEY = 'catch-tab-account';

function tabUserId() {
  const userId = sessionStorage.getItem(sessionKey(TAB_KEY));
  // Signed out since, in this tab or another.
  return userId && getAccounts().some(({ user }) => user.id === userId) ? userId : null;
}

// The number each account has in addresses on this device (`/u/2/archive`). Kept after a
// sign-out, so a bookmark still means the same account once it signs in again, and a number
// is never handed to anyone else.
const NUMBERS_KEY = 'catch-account-numbers';
const numbersSchema = z.record(z.string(), z.number().int().positive());

function accountNumbers() {
  const numbers = read(NUMBERS_KEY, numbersSchema) ?? {};
  let last = Math.max(0, ...Object.values(numbers));
  let added = false;
  for (const { user } of getAccounts()) {
    if (numbers[user.id]) continue;
    numbers[user.id] = ++last;
    added = true;
  }
  if (added) localStorage.setItem(sessionKey(NUMBERS_KEY), JSON.stringify(numbers));
  return numbers;
}

// The phone's app has no address bar to read one from, and nothing to bookmark.
const numbersAddresses = () => !Capacitor.isNativePlatform();
const NUMBERED = /^\/u\/(\d+)(?=[/?#]|$)/;
const prefixFor = (userId: string) => `/u/${accountNumbers()[userId]}`;

/**
 * The address of a page as one of the device's accounts, for a full page load: `/u/2/archive`
 * while several are signed in (ADR 0019). With one account there is nobody to tell apart,
 * and addresses stay as they always were.
 */
export function accountPath(userId: string, path = '/') {
  if (!numbersAddresses()) return path;
  // A destination kept from another account's address goes to this one's.
  const plain = path.replace(NUMBERED, '') || '/';
  const rest = plain.startsWith('/') ? plain : `/${plain}`;
  return getAccounts().length > 1 ? prefixFor(userId) + rest : rest;
}

/**
 * Settles whose page this is before anything reads it, from the address: `/u/<number>/…`
 * names an account, as a bookmark or another tab's link does, and a notification says whose
 * note it opens (`?account=<id>`), since the service worker does not know the numbers. An
 * address that names nobody belongs to the tab's account, or for a new tab the one last used
 * on the device. Returns the account and the prefix its addresses carry.
 */
function resolvePage(): { userId: string | null; prefix: string } {
  const url = new URL(window.location.href);
  const show = () => window.history.replaceState(window.history.state, '', url);
  const numbered = NUMBERED.exec(url.pathname);
  if (numbered && numbersAddresses()) url.pathname = url.pathname.slice(numbered[0].length) || '/';
  const signedIn = (userId: string | undefined) =>
    getAccounts().find(({ user }) => user.id === userId)?.user.id;
  const tab = tabUserId() ?? activeUser()?.id ?? null;

  let userId = tab;
  let named = false;
  const linked = url.searchParams.get('account');
  url.searchParams.delete('account');
  if (linked !== null) {
    if (signedIn(linked)) {
      userId = linked;
      // Said once the app is up: a link, not the user, chose the account.
      if (linked !== tab) sessionStorage.setItem(SWITCHED_KEY, 'true');
    } else {
      // Not signed in here any more, so its note is not one this page could open.
      url.searchParams.delete('note');
    }
  } else if (numbered && numbersAddresses()) {
    const numbers = accountNumbers();
    const owner = signedIn(Object.keys(numbers).find((id) => numbers[id] === Number(numbered[1])));
    if (owner) {
      userId = owner;
      named = true;
    } else {
      // Nobody signed in here has that number. Signing in leads to the page that was asked
      // for, as whoever signs in.
      const redirect = url.pathname + url.search;
      url.pathname = '/login';
      url.search = redirect === '/' ? '' : `?${new URLSearchParams({ redirect })}`;
    }
  }
  // A new tab on the account last used has nothing to change on the device.
  if (userId && userId !== tab) activateAccount(userId);
  if (userId) sessionStorage.setItem(sessionKey(TAB_KEY), userId);

  const prefix =
    userId && numbersAddresses() && (named || getAccounts().length > 1) ? prefixFor(userId) : '';
  url.pathname = prefix + url.pathname;
  if (url.href !== window.location.href) show();
  return { userId, prefix };
}

const page = resolvePage();

/**
 * What this page's addresses start with: `/u/<number>` or nothing. The router is mounted on
 * it, so routes and links never mention it; only a full page load has to (`accountPath`).
 */
export const basePath = page.prefix;

/** The address of a page of this tab's account, for a plain link or a full page load. */
export const pagePath = (path: string) => basePath + path;

/** The path of the page showing, as routes name it. */
export const currentPath = () => window.location.pathname.slice(basePath.length) || '/';

/**
 * The account this page was loaded for. Collections open that user's database when the app
 * starts (ADR 0007), so the page keeps sending that account's token whatever another tab
 * switches to, and after this tab has chosen another, until it loads again. Once set it never
 * changes: a page whose account signed out has no session, not somebody else's.
 */
let pageUserId = page.userId;

/** Every account signed in on this device (ADR 0019), in the order they were added. */
export function getAccounts(): Account[] {
  let accounts = read(ACCOUNTS_KEY, z.array(accountSchema)) ?? [];
  const user = activeUser();
  const token = activeToken();
  // An older build ended or replaced the session this one had in use, and with it the account.
  const marked = localStorage.getItem(sessionKey(ACTIVE_KEY));
  if (marked && (!token || user?.id !== marked)) {
    accounts = accounts.filter((account) => account.user.id !== marked);
  }
  if (!user || !token) return accounts;
  // The session in use is the newer word on its account, and the only record of one from
  // before the list was kept.
  const active = { user, token };
  return accounts.some((account) => account.user.id === user.id)
    ? accounts.map((account) => (account.user.id === user.id ? active : account))
    : [...accounts, active];
}

function writeAccounts(accounts: Account[]) {
  if (accounts.length > 0) {
    localStorage.setItem(sessionKey(ACCOUNTS_KEY), JSON.stringify(accounts));
  } else {
    localStorage.removeItem(sessionKey(ACCOUNTS_KEY));
  }
}

function writeActive(account: Account) {
  localStorage.setItem(sessionKey(TOKEN_KEY), account.token);
  localStorage.setItem(sessionKey(USER_KEY), JSON.stringify(account.user));
  localStorage.setItem(sessionKey(ACTIVE_KEY), account.user.id);
}

function clearActive() {
  localStorage.removeItem(sessionKey(TOKEN_KEY));
  localStorage.removeItem(sessionKey(USER_KEY));
  localStorage.removeItem(sessionKey(ACTIVE_KEY));
}

function saveAccount(account: Account, activate: boolean) {
  const accounts = getAccounts();
  const known = accounts.some(({ user }) => user.id === account.user.id);
  writeAccounts(
    known
      ? accounts.map((other) => (other.user.id === account.user.id ? account : other))
      : [...accounts, account],
  );
  if (activate || activeUser()?.id === account.user.id) writeActive(account);
}

const pageAccount = () =>
  pageUserId ? (getAccounts().find(({ user }) => user.id === pageUserId) ?? null) : null;

export function getAuthToken(): string | null {
  return pageUserId ? (pageAccount()?.token ?? null) : activeToken();
}

/**
 * The user the saved token belongs to, remembered from the last session the server returned.
 * Offline there is no session to fetch, and the app still needs to know whose notes to open.
 */
export function getSignedInUser(): SignedInUser | null {
  return pageUserId ? (pageAccount()?.user ?? null) : activeUser();
}

/**
 * Makes a signed-in account this tab's, and the one a new tab starts with. The page must
 * load again afterwards. Other tabs keep the accounts they show.
 */
export function activateAccount(userId: string): boolean {
  const account = getAccounts().find(({ user }) => user.id === userId);
  if (!account) return false;
  sessionStorage.setItem(sessionKey(TAB_KEY), userId);
  // Written to the list first: making it the session in use must not drop the one it replaces.
  writeAccounts(getAccounts());
  writeActive(account);
  return true;
}

/** Whether the account this page was loaded for has been signed out, here or in another tab. */
export function pageAccountGone() {
  return pageUserId !== null && pageAccount() === null;
}

/** Forgets an account's session on this device. Its data here is the caller's to remove. */
export function forgetAccount(userId: string) {
  const wasActive = activeUser()?.id === userId;
  writeAccounts(getAccounts().filter(({ user }) => user.id !== userId));
  if (wasActive) clearActive();
}

/** Forgets the session this page uses, leaving the device's other accounts signed in. */
export function clearAuthToken() {
  const userId = pageUserId ?? activeUser()?.id;
  if (userId) {
    forgetAccount(userId);
  } else {
    // A token from before the app remembered whose it was.
    clearActive();
  }
}

function userOf(data: unknown): SignedInUser | null {
  if (!data || typeof data !== 'object' || !('user' in data)) return null;
  const parsed = signedInUserSchema.safeParse(data.user);
  if (!parsed.success) return null;
  const { id, name, email } = parsed.data;
  return { id, name, email };
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
      const url = String(context.request.url);
      if (/\/(sign-in|sign-up)\//.test(url)) {
        if (!token) return;
        // A new session joins the device's accounts and becomes the one in use. A page that
        // already has an account keeps it until the load that follows: its collections and
        // outbox are still that account's, and must not send with the new one's token.
        const user = userOf(context.data);
        if (user) {
          saveAccount({ user, token }, true);
          // The load that follows is this tab's, as the account that just signed in.
          sessionStorage.setItem(sessionKey(TAB_KEY), user.id);
          pageUserId ??= user.id;
        } else {
          // Kept in the list first, since the keys below are about to name someone else.
          writeAccounts(getAccounts());
          clearActive();
          localStorage.setItem(sessionKey(TOKEN_KEY), token);
        }
        return;
      }
      // Anything else answers for this page's own session: a session response carries its
      // user, and a changed password a new token.
      const session = /\/get-session(\?|$)/.test(url);
      if (!token && !session) return;
      const current = getAuthToken();
      // The account was removed in another tab; a late response must not sign it back in.
      if (!current) return;
      const user = (session && userOf(context.data)) || getSignedInUser();
      if (!user) {
        if (token) localStorage.setItem(sessionKey(TOKEN_KEY), token);
        return;
      }
      if (pageUserId && user.id !== pageUserId) return;
      saveAccount({ user, token: token ?? current }, pageUserId === null);
      pageUserId = user.id;
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
