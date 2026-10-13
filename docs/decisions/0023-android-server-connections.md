# 0023: Android accounts on several servers

Status: accepted (2026-10-12)

## Context

Android bundled the app at one WebView origin and stored one server address. Several
accounts could stay signed in (ADR 0019), but all belonged to that server. Device stores
were named after the server user ID, and reminder receipts assumed note IDs were unique
across accounts. A restored or cloned server preserves those IDs.

## Decisions

**An Android account belongs to a server origin.** Released bundles keep a versioned
`catch-server-accounts` registry of normalized origins, sessions and stable local account
identities. A server/user pair gets one device identity, retained after sign-out so a
later sign-in finds the same namespace. Remote user and note IDs are unchanged: they
still name synced rows and authenticated encryption. Origins cannot be edited in place;
a moved server is added as a separate connection. Alias discovery and data transfer
between servers are outside this change.

**The account switcher stays the entry point.** It shows a server hostname under each
account. Add account first offers saved servers or an HTTPS address/invite link, then
shows the existing sign-in form with the chosen hostname. Cancelling returns to saved
notes without changing their connection. Saved connections can be selected offline.
Signing out removes just that account's device data; its server address stays available
for another sign-in. There is no combined cross-server gallery or background note sync.

**A page keeps both its account and server.** Startup resolves the account before
constructing Better Auth, collections and the outbox. Its origin stays fixed until a
full reload; choosing another connection cannot redirect old writes or credentials.
Login for another server has no existing bearer token. Switching waits for pending
writes to reach durable device storage, rather than waiting for network delivery.
Sign-out of an inactive account explicitly uses its own server and token.

**Local storage belongs to the device account identity.** SQLite, the outbox and its
leader lock, attachment files, history and recovery drafts, remembered vault keys,
incoming-share ownership, import state and account preferences use this identity.
Network payloads and cryptographic bindings keep using the original remote IDs.

**Existing stores are adopted without moving them.** The registry binds existing
sessions to the previously configured server, retaining their user IDs as local
identities. The one atomic registry write marks adoption; no database is renamed and
no outbox payload is rewritten or dropped. New identities use an `n-` prefixed UUID.
Corrupt registry data is refused rather than silently assigned to a new server.
Legacy session keys are no longer authoritative and are cleared after adoption. An
older APK cannot safely understand these namespaces: downgrading is unsupported and
must not be used to access unsynced changes from this build.

**Native integrations also use device identities.** Reminders already keep a URL and
token per account. Alarm PendingIntents, notification tags, rung receipts and snoozes
now identify an account/note pair. Snooze acknowledgement affects one account only.
Widgets keep each account's origin with its snapshot instead of discarding every
widget when the foreground server changes. A cold or warm tap can switch to another
server without repointing the widget. Labels include the hostname. Old first-server
widget/account identities survive adoption.

**Links retain their server.** A shared-note link on another origin offers an explicit
Open action for a saved account on that server, or Connect with the address prefilled.
Open editors must close before the full reload. Invites entered during setup retain
their fragment through login.

**The PWA remains tied to its own origin.** Each server serves its own browser app,
with origin-isolated storage and Web Push. Worktree live-reload and pinned development
bundles keep their existing single-stack connection behavior. No server endpoint,
shape, schemaVersion, queued payload or API protocol changes are needed. Both old
client/new server and new client/old server retain the existing protocol contract.

## Consequences

- Adding a server affects only the Android device, without configuration on another server.
- Two servers restored from the same backup can coexist without sharing tokens or local data.
- Only the foreground account sends queued note changes. Every enabled account's reminders
  continue to ring; inactive widgets retain their last observed snapshot.
- Automatic URL changes, deleting saved server addresses, cross-server note movement and
  one PWA connecting to several servers are separate features.
- Regression coverage must include migration, duplicate IDs, offline switching,
  reauthentication, sign-out, and native notification/widget launches across servers.
