# 0011: Admin settings and user roles

Status: accepted (2026-10-01)

## Decision

Settings groups personal pages under User and server-wide pages under Admin, in both the
desktop navigation and the phone picker. Only a live admin session shows the Admin group.
All admin pages live under `/settings/admin` with a shared route guard; all administrative
API endpoints live under `/api/admin` with a shared server guard.

The user directory exposes only account id, name, email, role, creation date and last login. It is an
explicit exception to per-user reads: authenticated admins can list accounts across the
server. Notes and other personal data keep their existing user filters. Directory searches
and role changes use the REST API online, without syncing or persisting this directory in
the device's database or outbox.

The server checks the actor's current database role on every administrative request. Role
edits, password resets and deletion serialize in a transaction and recheck the actor after acquiring the lock, so an
admin demoted by a concurrent request cannot change another account's role. Admins cannot
change their own role, reset their own password through admin controls, or delete themselves;
together these rules preserve at least one admin.

An admin password reset generates a cryptographically random temporary password, hashes it
with Better Auth's configured password hasher, and revokes the target's sessions in the same
transaction. The password is returned with `Cache-Control: no-store` and stays only in the
open result dialog, where the admin can copy it. It does not expire automatically; the user
can replace it through Account > Change password, which revokes other sessions.

Deleting an account cascades to its credentials, sessions, notes, board columns, previews
and attachment metadata. The server also removes that user's attachment bytes and thumbnails.
The target row is locked before collecting files to prevent new dependent rows from being
added during deletion. Shared preview assets belong to the server cache and remain available
to other users. Both destructive actions require a confirmation identifying the target.

`user.lastLoginAt` records the latest successful session creation, including sign-up's
automatic sign-in. Session refreshes, password-change session replacements and failed sign-ins do not advance it. Concurrent
sign-ins retain the latest timestamp. The migration fills known historical login dates
from existing sessions; accounts without session history keep a null date, shown as “—”.

## Consequences

- Personal settings continue to work offline; administrative pages require the server.
- A hidden navigation item is not authorization. Direct page visits and API requests are
  guarded independently, including requests from sessions opened before a demotion.
- Roles use the existing `user.role` column; login tracking adds a nullable timestamp through
  a migration. Neither field needs a synced collection.
