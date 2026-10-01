# Catch — agent guide

Catch is a self-hosted, offline-first alternative to Google Keep. It ships as a
web app (installable PWA) and a native Android app built from the same code.

Read `docs/decisions/` before changing architecture. If a decision there no
longer holds, update it in the same change rather than working around it.

## Layout

| Path | What lives there |
| --- | --- |
| `apps/web` | Vite + React SPA, TanStack Router (file routes in `src/routes`), TanStack DB, Tailwind v4 + shadcn/ui. Also the Capacitor Android project (`android/`). |
| `apps/server` | Hono API on Node. Better Auth, Drizzle (Postgres), Electric shape proxy. Serves the built web app in production. |
| `packages/shared` | Zod schemas, types and pure helpers used by both apps. Exported as TypeScript source (no build step). |
| `e2e` | Playwright tests that drive the real app against the dev database. |
| `docs/decisions` | Short architecture decision records. |

## Commands

Development runs in Docker, one isolated stack per Git worktree (see `WORKTREES.md`).
Always go through `./scripts/dev.sh` from the checkout you are working in; it targets that
checkout's stack. Never hard-code container or project names.

- `./scripts/dev.sh up`: start this worktree's stack and print its URL. Hot reload is on.
- `./scripts/dev.sh check`: lint, typecheck, unit tests, build. **Must pass before you finish.**
- `./scripts/release.sh <stable|preview> <major|minor|patch> [--dry-run]`: tag HEAD locally.
  Use `stable promote [preview-tag]` to preserve a tested preview's version and commit.
  See `docs/releases.md`; pushing a tag explicitly can trigger release builds.
- `./scripts/dev.sh e2e`: Playwright tests against this worktree's stack.
- `./scripts/dev.sh generate`: create a migration after editing `apps/server/src/db/schema.ts`.
  Commit the generated SQL and journal.
- `./scripts/dev.sh logs app`, `psql`, `shell`, `seed`, `reset -y`: see `./scripts/dev.sh help`.
- `pnpm format` (host): apply Biome formatting and import sorting.
- `./scripts/dev.sh android [--usb]` (host): install a live-reload debug app on a connected
  phone. It loads this worktree's Vite server, so it only needs rerunning after native changes.
- `pnpm --filter @catch/web android:sync` (host): build the web app into the Android project.

Seeded logins: `admin@example.com` / `adminadmin` and `user@example.com` / `userpassword`.

### Working in parallel

- Work in the checkout or worktree you are started in. Agents must not create or switch
  to their own worktrees unless the user explicitly asks them to. Run `./scripts/dev.sh up`
  from the assigned checkout when needed.
- Only one agent should change the database schema at a time (Drizzle migrations are
  numbered; see `WORKTREES.md`).
- When asked to merge a worktree into `main`, merge its branch into `main` from the primary
  checkout, then push the updated `main` to its configured upstream. Check the merge result
  and working tree before pushing; never force-push `main`.
- When your work is committed and merged, finish with `./scripts/worktree.sh self-remove -y`
  from inside the worktree. It refuses to delete uncommitted work.

## How data flows

1. Clients read through **TanStack DB collections** (`apps/web/src/lib/collections.ts`), which
   Electric keeps in sync with Postgres. Each user's collections are kept in SQLite on the
   device (`lib/localStore.ts`, ADR 0007), so notes show offline.
2. Clients never talk to Electric directly. `GET /api/shapes/*` is an auth proxy that pins
   each shape to the signed-in user's rows and an explicit column list.
3. Writes are optimistic and queued: `write()` applies them to the collection immediately and
   stores them in an outbox, which sends them to the REST API in order, retrying until the
   server has them. The API returns the Postgres `txid` so the optimistic state is dropped
   once Electric streams that transaction back, or `{ txid: null }` for a replayed write it
   already applied.
4. IDs are UUIDv7 and are generated **on the client** so notes can be created offline.
5. Note content is BlockNote JSON (`blocks`). The server derives `searchText` from it on
   write; Markdown only appears at import and export boundaries.
6. Components call the note actions in `apps/web/src/lib/notes.ts` (pin, archive, trash, ...)
   rather than mutating the collection directly. Those actions wrap their changes in `write()`;
   collections have no mutation handlers, so a change outside `write()` throws.

When adding a synced table: add it to the Drizzle schema, generate a migration, add a Zod
schema to `packages/shared`, add a shape route with a user filter and a column allowlist, add
write routes that return `{ txid }` (and are safe to replay), then add a persisted collection.
If clients write to it, add it to `writableCollections` and `send()` in `collections.ts`.

## Conventions

- Use Conventional Commits: `<type>(<optional scope>): <description>`, for example
  `feat(android): add preview releases` or `fix(sync): retry interrupted writes`.
  Use `!` or a `BREAKING CHANGE:` footer for breaking changes.
- TypeScript strict everywhere. No `any`; validate unknown data with Zod.
- Request and response shapes come from `packages/shared`. Do not redeclare them in an app.
- Style with Tailwind utilities and the tokens in `apps/web/src/styles.css`. Tokens already
  handle dark mode via `light-dark()`, so avoid `dark:` variants. The look and motion rules are
  in `docs/decisions/0003-design-system-and-motion.md`.
- Trigger haptics through the named events in `apps/web/src/lib/haptics.ts`.
- A new Settings page is an entry in `SETTINGS_TABS` (`apps/web/src/lib/settings.ts`) plus a
  route file in `apps/web/src/routes/_app/settings/`, built from `SettingsSection` and
  `SettingsRow`. The desktop list and the dock's picker both read `SETTINGS_TABS`.
- Add UI primitives with `pnpm dlx shadcn@latest add <component>` from `apps/web`; they land
  in `src/components/ui` and are ours to edit.
- Feature components go in `apps/web/src/components/<Name>/<Name>.tsx` with a
  `<Name>.test.tsx` next to them.
- Design for touch first: no hover-only controls on mobile widths.
- Every Postgres query that touches user data filters by `userId`.
- Keep comments for the *why*; do not narrate the code.

## Gotchas

- A new workspace package needs its own `node_modules` volume in `docker-compose.dev.yml`,
  or the container will install dependencies into the bind-mounted checkout.

- Electric rows skip the collection's Zod schema, so column types that need parsing (such as
  `timestamptz` into `Date`) go in the `parser` option in `collections.ts`.
- BlockNote is lazy-loaded (`LazyNoteEditor`). E2E tests must wait for the editor to be
  focused before typing.
- `catch` is a Java keyword, so the Android application id is `org.iloni.catchnotes`.
- The Android app runs on `https://localhost`, a different origin than the server, so all
  clients authenticate with Better Auth bearer tokens (`set-auth-token` header), not cookies.
- Android blocks cleartext HTTP by default, so the Android app needs the server on HTTPS.
- The on-screen keyboard overlays the page instead of resizing it (see ADR 0003). Keep fixed
  bottom UI above it with `var(--keyboard)`, and keep focus in editors by calling
  `preventDefault()` on `pointerdown` in buttons that act on them.
- The app draws edge to edge. Pad fixed UI with the `--safe-top` / `--safe-bottom` tokens and
  leave `--dock-space` at the bottom of pages. A transform or filter on an ancestor breaks the
  fixed page headers and dock.
- A `view-transition-name`, `filter` or `opacity` below 1 on the dock or its ancestors makes a
  backdrop root, and the dock's glass stops blurring the page behind it. The dock is named
  only during a transition (`html:active-view-transition [data-dock]` in `styles.css`).
- On wide screens an open note sits in a pane beside the page (`lib/splitView.ts`, ADR 0003).
  Fixed UI over the page spans `left-0 right-[var(--note-pane)]`, not `inset-x-0` (except the
  dock, which pads the pane away so its view-transition box keeps one size), and layout
  inside a page should follow its own width (container queries, `ResizeObserver`), not the
  viewport's breakpoints.
- The note editor grows out of the element passed to `open(id, element)` (see `lib/openNote.ts`);
  anything that shows a note as a card should pass itself and set `data-note-card={note.id}`.
- `NoteGrid` renders only cards near the viewport, so a note's card may not be in the DOM.
  A card builds its actions (and their tooltips) on hover or focus; E2E tests hover a card
  before clicking its toolbar.
- While a note is open, its actions live in the dock (`NoteDock`), outside the editor dialog.
  The dialog is non-modal and ignores interactions inside `[data-dock]`; the page behind is
  `inert`. The editor publishes its note and controls through `editorNote`/`editorControls`
  in `lib/dockState.ts`.
- Notes are ordered by `position`, a fractional index (ADR 0004). Compare positions with
  `comparePositions` (code units); `localeCompare` and Postgres collations order them wrongly.
- Link previews are derived from a note's links, not stored in it (ADR 0006). Read a note's
  previews with `useNoteLinks` (`lib/linkPreviews.ts`), which shares one subscription across
  every card. Server-side page fetches must go through `safeFetch`, which blocks private
  addresses.
- TanStack DB is pre-1.0. Keep its usage inside `src/lib/collections.ts`, `src/lib/localStore.ts`
  and route files so upgrades stay contained.
- Bump a collection's `schemaVersion` in `collections.ts` whenever the columns its shape syncs
  change, or devices keep reading rows of the old shape from their local database.
- Collections open the signed-in user's local database when the module loads (top-level
  await), so signing in does a full page load. Offline, collections never become ready (that
  needs the server); pages wait with `useAwaitingSync`, not `isLoading`.
- Importers (Settings > Data Management) read exports on the device and add notes with
  `importNotes`, giving each a UUIDv7 derived from its source so importing again skips it
  (`importedNoteId`, ADR 0008). Read archives with `lib/zip.ts`, which never loads a whole file.
- The dev server has no service worker, so a page cannot load code offline in development.
  E2E tests for offline behavior block `/api` instead, or warm lazy chunks before going offline.
