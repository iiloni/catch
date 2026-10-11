# 0007: Offline persistence

Status: accepted (2026-09-29)

## Context

Catch promises to work offline. Writes were already optimistic and IDs are made on the
client, but collections lived in memory and writes needed a connection: a reload without the
server showed no notes, and a change made offline was rolled back. ADR 0001 chose Electric
and TanStack DB over a hand-rolled IndexedDB queue, so offline support should come from
TanStack DB's own packages rather than a parallel store.

## Decisions

**Synced data lives in SQLite on the device.** Each synced collection is wrapped in
`persistedCollectionOptions` (`@tanstack/db-sqlite-persistence-core`). On the web the
database is wa-sqlite in the origin private file system, in a worker
(`@tanstack/browser-db-sqlite-persistence`), shared by tabs through its
`BrowserCollectionCoordinator`. In the Android app it is native SQLite through
`@capacitor-community/sqlite` (`@tanstack/capacitor-db-sqlite-persistence`). The Electric
collection keeps its shape handle and offset in the same database, so a reload shows the
device's copy at once and resumes the stream where it stopped instead of syncing everything
again. `lib/localStore.ts` opens the right database; `lib/collections.ts` wraps the
collections. If the database cannot open (no OPFS, for example), collections fall back to
memory and the app works online as before.

The browser coordinator routes leader operations to the adapter registered for each
collection. Collections may have different schema versions; the persistence package's
default coordinator wiring selects the last-created adapter for every collection, which
can reset another collection's cached rows or race its table creation. Routing preserves
one coordinator and database-wide writer lock across tabs, while each collection uses
its own schema version for both reads and leader operations.
We patch the SQLite core's schema reset to delete that collection's sync metadata in the
same transaction as its cached rows. Otherwise Electric resumes after the removed rows
instead of fetching a new snapshot. Other collections and the outbox stay intact.

**HTTP development uses short polls.** With six or more collections, live long polls occupy all six
HTTP/1.1 browser connections to the dev server. Lazy pages, HMR and writes then wait for a
20-second sync timeout. `lib/shapeFetch.ts` makes live requests to an HTTP development
server as non-live reads from the same handle and offset, waiting one second on the device
between requests and bypassing caches for those reads. The adapter supplies the opaque
cache cursor that Electric's live-request validator requires on successful responses;
the server's shape handle, offset, schema, transaction metadata and body pass through.
Initial sync and catch-up requests
run immediately. Cancellation and protocol gating still apply; persisted data and queued
writes keep their existing formats. HTTPS and production builds keep Electric's normal
long polling; production reverse proxies must offer HTTP/2. This compatible transport fix
does not change the API protocol or collection schema versions.

Incoming-note creation explicitly awaits the persistence wrapper's cached-row loader for
notes, attachments, columns, tags and assignments. TanStack DB's collection-level subset
loader does nothing for Electric's eager collections; awaiting it does not wait for cached
rows. Keeping the wrapper's loader allows captures to resolve their choices and existing
receipts before saving without requiring an online Electric snapshot.

**One database per user.** Electric identifies a shape by URL alone, and every user syncs the
same URLs, so a shared database would resume one user's stream for another. The database and
outbox are named after the user id. The app remembers the signed-in user next to the token
(`getSignedInUser`), since offline there is no session to fetch. Signing in does a full page
load so the collections open that user's database; signing out deletes the database and the
outbox after warning about changes that have not synced. Several accounts can be signed in
at once (ADR 0019); each keeps its own database and outbox, and only the one in use syncs.

**Writes go through an outbox.** `@tanstack/offline-transactions` stores every write in
IndexedDB before it is applied, then sends the queue in order, retrying with backoff until
the server has it. Components still call the actions in `lib/notes.ts` and
`lib/boardColumns.ts`; those wrap their collection changes in `write()` from
`collections.ts`, and the collections have no mutation handlers of their own, so a direct
`collection.update` fails loudly. One function (`pushWrites`) sends a queued transaction's
mutations to the REST API and waits for Electric to stream their txids back. On startup the
outbox restores the optimistic state of writes left by an earlier visit and merges queued
content saves of the same note (`mergeQueuedWrites`), since autosave queues the whole note
every time typing pauses.

**Failures are sorted, not all retried.** Network errors, 5xx, 408 and 429 are retried. A 401
waits for the user to sign in again (the indicator offers it; the device keeps its data and
queue, so signing in as the same user sends them). Any other 4xx, or a change that fails
the shared schema, can never succeed: it is dropped, rolled back and reported with a toast.
The outbox itself gives up on errors whose message mentions some 4xx codes, so retried
errors get fixed messages.
Shape requests also pause on a 401 instead of putting the collection in a terminal error
state, so cached notes stay readable and editable while the sign-in indicator is shown.

**Replays are safe.** A write can reach the server twice, when a response is lost or the
stream is slow to confirm it. Creating a note or column whose id the user already has, and
deleting one that is gone, return `{ txid: null }` (`txidResponseSchema`): already done,
nothing new to wait for. A PATCH of a missing row stays a 404, which drops that change.
Creating a note with another user's id is a 409.

**Last write wins, per field.** An update sends only the fields it changed, so edits to
different fields of a note on two devices both survive. Edits to the same field, including
a note's content, are applied in the order they reach the server: an offline edit sent later
replaces what another device saved in the meantime. The server still stamps `updatedAt` when
it applies an update, so "Last edited" is the sync time for offline edits. A new note keeps
the dates it was made with on the device (ADR 0008), unless they are later than the server's
clock.

**Status.** `lib/syncStatus.ts` tracks pending writes, whether the device is offline (or the
server did not answer), and whether the session was refused. The page headers show a cloud
button while changes cannot reach the server, with the number waiting; the editor says
"Saved on this device" instead of spinning. Pages that waited for collections to be ready
stop waiting once the device's copy has something to show, or when offline
(`useAwaitingSync`): Electric only marks a collection ready once it reaches the server.

## Consequences

- Only one tab per user keeps the outbox (a Web Lock names the leader). Other tabs send
  their writes directly and need a connection; offline, the indicator says so, and their
  writes roll back with a toast. When the leader tab closes, another takes over.
- Bump a collection's `schemaVersion` in `collections.ts` when the columns its shape syncs
  change. Devices then drop their copy of that collection and sync it again.
- The web app needs its service worker to start offline. Preview images are cached by it
  too (they never change), so previews keep their pictures offline.
- The dev server has no service worker, so e2e tests cut off `/api` rather than the whole
  network, and warm the lazy editor before going offline. A fully offline start of a
  production build was checked by hand with `vite preview`: reload offline, write and edit,
  reload again, reconnect.
- The SQLite worker is 1.7 MB (its WASM is inlined), precached by the service worker, and
  excluded from Vite's dependency pre-bundling so it stays next to its module.
- The persistence packages are 0.2.x. Their use stays in `collections.ts` and `localStore.ts`.

Note history (ADR 0022) keeps account-scoped compressed/encrypted payloads and crash-recovery
drafts in IndexedDB, outside synced note rows. Immutable captures use separate outbox
transactions on the small `note-history` control collection, so coalescing a live content
save never removes a historical checkpoint. Startup reconciles staged jobs with the outbox.
Original restores are freshness-checked online requests, not optimistic outbox mutations;
cached versions can be copied offline. Sign-out deletes the history store for that account.
