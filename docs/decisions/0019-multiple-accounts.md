# 0019: Several accounts on one device

Status: accepted (2026-10-05)

## Context

A device held one session. Someone with two accounts on a server (their own and a shared
household one, say) had to sign out to reach the other, and signing out deletes that
account's copy of its notes and any change that has not synced (ADR 0007).

## Decisions

**The device keeps a list of sessions; one is in use.** `lib/auth.ts` stores every signed-in
account's user and bearer token under `catch-accounts`. The session in use stays under the
keys it always had (`catch-auth-token`, `catch-user`), so a session from an older build is
simply the list's first entry, and an older build still finds its session after a downgrade.
Signing in adds to the list and makes the new account the one in use; signing in again as a
listed account replaces its token. The server is not involved: each account has an ordinary
session, and no request, response or shape changes.

**Switching is a full page load.** Collections open one user's database when the module
loads (ADR 0007), so `switchAccount` changes the session in use and loads the app again, as
signing in does. Each account already had its own database, outbox, attachment files and
per-user settings; the other accounts' stay on the device untouched.

**A page belongs to the account it loaded for.** `getAuthToken` and `getSignedInUser` answer
for that account, not for whichever the device has since switched to in another tab.
Otherwise a tab would send one account's queued writes with another's token. A tab that
sees the device switch, or its account signed out, loads again to follow.

**Only the account in use syncs and rings.** Its outbox sends and its shapes stream. Another
account's queued changes wait on the device until it is switched to. Reminders follow the
account in use too: a browser has one push subscription, which the server gives to whoever
saved it last, and the Android app holds one token and one list of alarms.

**Signing out removes one account.** For the account in use it is what it was, then the
device carries on as the next account, or goes to sign-in when none is left. For another
account, `signOutAccount` ends its session with its own token and deletes its database,
outbox and files without opening them. Both warn first about changes that have not synced;
for an account not in use the count is read from its outbox's store.

**The avatar in the Gallery header is the switcher.** A tap opens the list of accounts, with
sign-out for each and "Add account", which goes to the sign-in page. A swipe across the
avatar in any direction changes to the next or previous account. A switch is refused while a
note or composer is open, since the load would drop what it has not saved. Avatars take a
hue from the account's id so accounts with the same initials can be told apart.

## Consequences

- Preferences that were per device stay per device: theme, gallery layout, recent searches.
- The session cookie Better Auth leaves in a browser is the last account to sign in. The
  bearer token takes precedence over it on every request, which `e2e/accounts.spec.ts` checks
  by writing as the first account after the second signed in.
- A tapped notification for an account that is not in use opens the app as the account that
  is, where its note does not exist.
