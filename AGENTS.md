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

- Start new work in its own worktree: `./scripts/worktree.sh create <branch>`, then
  `./scripts/dev.sh up` inside it.
- Only one agent should change the database schema at a time (Drizzle migrations are
  numbered; see `WORKTREES.md`).
- When your work is committed and merged, finish with `./scripts/worktree.sh self-remove -y`
  from inside the worktree. It refuses to delete uncommitted work.

## How data flows

1. Clients read through **TanStack DB collections** (`apps/web/src/lib/collections.ts`), which
   Electric keeps in sync with Postgres.
2. Clients never talk to Electric directly. `GET /api/shapes/*` is an auth proxy that pins
   each shape to the signed-in user's rows and an explicit column list.
3. Writes are optimistic: the collection updates immediately, the mutation handler calls the
   REST API, and the API returns the Postgres `txid` so the optimistic state is dropped once
   Electric streams that transaction back.
4. IDs are UUIDv7 and are generated **on the client** so notes can be created offline.
5. Note content is BlockNote JSON (`blocks`). The server derives `searchText` from it on
   write; Markdown only appears at import and export boundaries.
6. Components call the note actions in `apps/web/src/lib/notes.ts` (pin, archive, trash, ...)
   rather than mutating the collection directly.

When adding a synced table: add it to the Drizzle schema, generate a migration, add a Zod
schema to `packages/shared`, add a shape route with a user filter and a column allowlist, add
write routes that return `{ txid }`, then add a collection.

## Conventions

- TypeScript strict everywhere. No `any`; validate unknown data with Zod.
- Request and response shapes come from `packages/shared`. Do not redeclare them in an app.
- Style with Tailwind utilities and the tokens in `apps/web/src/styles.css`. Tokens already
  handle dark mode via `light-dark()`, so avoid `dark:` variants. The look and motion rules are
  in `docs/decisions/0003-design-system-and-motion.md`.
- Trigger haptics through the named events in `apps/web/src/lib/haptics.ts`.
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
  Fixed UI over the page spans `left-0 right-[var(--note-pane)]`, not `inset-x-0`, and layout
  inside a page should follow its own width (container queries, `ResizeObserver`), not the
  viewport's breakpoints.
- The note editor grows out of the element passed to `open(id, element)` (see `lib/openNote.ts`);
  anything that shows a note as a card should pass itself and set `data-note-card={note.id}`.
- While a note is open, its actions live in the dock (`NoteDock`), outside the editor dialog.
  The dialog is non-modal and ignores interactions inside `[data-dock]`; the page behind is
  `inert`. The editor publishes its note and controls through `editorNote`/`editorControls`
  in `lib/dockState.ts`.
- Notes are ordered by `position`, a fractional index (ADR 0004). Compare positions with
  `comparePositions` (code units); `localeCompare` and Postgres collations order them wrongly.
- TanStack DB is pre-1.0. Keep its usage inside `src/lib/collections.ts` and route files so
  upgrades stay contained.
