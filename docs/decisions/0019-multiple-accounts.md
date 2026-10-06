# 0019: Several accounts on one device

Status: accepted (2026-10-05)

## Context

A device held one session. Someone with two accounts on a server (their own and a shared
household one, say) had to sign out to reach the other, and signing out deletes that
account's copy of its notes and any change that has not synced (ADR 0007).

## Decisions

**The device keeps a list of sessions.** `lib/auth.ts` stores every signed-in
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

**A tab shows one account, and tabs can show different ones.** A tab remembers its account
in `sessionStorage` (`catch-tab-account`), so it keeps it across reloads while another tab
switches. The session in use on the device is only where a new tab starts: the account last
switched to or signed in. Each account already has its own database, outbox leader lock and
files, so two tabs on two accounts sync side by side, and two tabs on one account share its
database as before (ADR 0007). The Android app is one tab.

**The address says whose page it is.** While several accounts are signed in, a browser's
addresses start with the account's number on the device: `/u/2/archive`,
`/u/2/?note=<id>`. So a bookmark, a copied address or a link opened in a new tab leads to
the same account's page, whatever the tab or the device was last showing. `lib/auth.ts`
reads the number when the page loads, before anything asks whose page it is, and the
router is mounted on the prefix (`basepath`), so routes and links never mention it. Only a
full page load to another account has to: `accountPath` builds its address, and `pagePath`
that of a plain link within this one.

- Numbers are per device, given in the order accounts first signed in here
  (`catch-account-numbers`). A number is kept after a sign-out: it is never given to
  another account, and an account that signs in again has the number its bookmarks name.
  The user's id would be the same on every device, but makes an address nobody can read or
  type.
- An address with no number means the tab's account, or for a new tab the one last used.
  It gains the number when the page loads if several accounts are signed in. With one
  account, addresses stay as they were: there is nobody to tell apart, and an existing
  bookmark or the installed app's start address needs no number.
- An address whose number belongs to nobody signed in goes to the sign-in page, keeping the
  page asked for. Whoever signs in is taken to that page as themselves.
- The Android app has no address bar and keeps its addresses without numbers.

**A page belongs to the account it loaded for.** `getAuthToken` and `getSignedInUser` answer
for that account until the page loads again, whatever the tab or the device has since
moved to: another signing in from "Add account", a switch, or the next account after a
sign-out. Otherwise a page would send one account's queued writes with another's token in
the moment before it reloads. A page whose account has signed out has no session at all. A
tab that sees its account signed out in another tab leaves for another account or the
sign-in page (`followAccountChanges`), waiting first for an open note or composer to close.
It also deletes the account's database if the tab that signed it out could not, because
this one had it open.

**An older build's sign-out is noticed.** A build from before the list changes only the
session keys. `catch-active-account` records whose session this build last put in use; when
the keys no longer hold it, that account is dropped from the list rather than left there
with a session that has ended.

**Only accounts open in a tab sync.** Their outboxes send and their shapes stream. An account
open in no tab keeps its queued changes on the device until it is switched to.

**Every signed-in account's reminders ring.** Notifications are turned on for the device,
not for an account: on for one is on for all, including one added later.

- *Browsers.* A browser has one push subscription, so its endpoint can now belong to
  several users: `push_subscriptions` is keyed by endpoint and user. At launch the app
  saves the subscription for every signed-in account with that account's token
  (`syncPush`). The device records which accounts it has registered on the subscription;
  if one of them is no longer signed in here and the server was not told (a session that
  ended, an older build's sign-out, a sign-out offline), the subscription is replaced with
  a new one, so the old endpoint stops ringing for anyone. The server cannot do this
  itself: only the account can remove its own row.
- *The Android app* keeps a token and a list of alarms for each account
  (`ReminderAlarms.java`). The web app replaces the list of the account in use while it
  runs; the hourly background check asks the server for each account with its own token,
  which is how the other accounts' lists stay current. What has rung, and snoozes, are
  kept by note, since note ids are unique across accounts.
- *A notification says whose note it is.* The server adds the user's id to the push
  message, and the phone to its intent. Tapped, the app switches to that account and opens
  the note: an open app is told and calls `switchAccount`; with several tabs open the
  service worker first asks which of them shows that account; a cold start loads
  `/?note=<id>&account=<user id>`, since the service worker cannot read the device's
  numbers, and `lib/auth.ts` makes that account the page's before anything reads it,
  replacing the parameter with the account's number. On Android the notification also shows the account's name when
  the phone rings for more than one. A snooze taken from a notification is written to the
  server when its account is next in use.

**Signing out removes one account.** For the account in use it is what it was, then the
device carries on as the next account, or goes to sign-in when none is left. For another
account, `signOutAccount` ends its session with its own token and deletes its database,
outbox, files and per-user settings without opening them. Both warn first about changes that have not synced;
for an account not in use the count is read from its outbox's store.

**The avatar in the Gallery header is the switcher.** A tap opens the list of accounts, with
sign-out for each and "Add account", which goes to the sign-in page. A swipe across the
avatar in any direction changes to the next or previous account. A switch is refused while a
note or composer is open, since the load would drop what it has not saved. Avatars take a
hue from the account's id so accounts with the same initials can be told apart.

## Compatibility

No request or shape changes shape, and the API protocol is unchanged. The push message gains
an optional `userId`, which an older service worker ignores. A new client against an older
server saves the subscription for each account in turn, the one in use last; that server
keeps one user per endpoint, so only the account in use rings, as before. An older web
client against a new server no longer takes an endpoint over from a previous user whose
session ended without a sign-out, so that user's reminders could reach the browser until
the new client loads and replaces the subscription; web clients update with the server, so
this lasts until the new build is running. The Android app's native code and web code ship
together. Migration `0010` only changes the table's key.

## Consequences

- Preferences that were per device stay per device: theme, gallery layout, recent searches.
- The session cookie Better Auth leaves in a browser is the last account to sign in. The
  bearer token takes precedence over it on every request, which `e2e/accounts.spec.ts` checks
  by writing as the first account after the second signed in.
- A web notification does not say which account it is for; the Android one does.
- A bookmark saved while one account was signed in has no number, and opens whichever
  account was last used once there are several. A numbered address means a different
  account, or nobody, on another device.
- Code that reads `window.location.pathname` sees the number. Compare `currentPath()`
  instead, and build an absolute link outside the router with `pagePath`.
- The ids of accounts that signed out stay on the device with their numbers.
- An account whose session has ended stays in the device's list until it signs in again or
  is signed out. Until then it keeps ringing: the server still has its subscription, and
  the phone keeps the alarms it had without refreshing them.
- The phone's background check leaves an account alone while that account has changes
  waiting on the device (ADR 0018), and an account's changes only send while it is in
  use. So an account left with unsent changes is not refreshed until it is switched back
  to.
- On upgrade every browser with notifications on replaces its subscription once, having no
  record yet of whose it was. This has not been tried on an installed iOS web app.
