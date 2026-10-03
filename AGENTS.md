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
- `./scripts/dev.sh backup <create|list|inspect|restore|...>`: the server backup tool against
  this worktree's stack. `scripts/backup.sh` and `scripts/update.sh` are the production host
  wrappers (see `docs/backups.md`); do not run them against a dev stack.
- `pnpm format` (host): apply Biome formatting and import sorting.
- `./scripts/dev.sh android [--static] [--usb]` (host): install Catch Dev on a connected
  phone. By default it loads Vite with live reload; `--static` bundles the frontend while
  using this worktree's HTTP API. Static installs need rerunning after web or native changes.
  `--usb` reaches the backend through adb instead of Tailscale in either mode.
- `pnpm --filter @catch/web android:sync` (host): build the web app into the Android project.

Seeded logins: `admin@example.com` / `adminadmin` and `user@example.com` / `userpassword`.

### Pull requests and CI

- For new features and code fixes, use a draft PR targeting `main` by default unless the
  user explicitly requests a different workflow. Work in the assigned checkout; if it is
  on `main`, create a feature branch there. Commit and push reviewable changes, open the
  draft PR and include its link in progress updates. Reuse an existing PR for the branch
  rather than creating a duplicate. Read-only questions do not require a PR.
- Add a small set of existing descriptive labels when opening the draft: `enhancement`
  for features or improvements, `bug` for defect fixes, `documentation` for substantive
  documentation changes, `accessibility` for accessibility work and `maintenance` for CI,
  build tooling, dependencies, refactoring or test infrastructure. Choose labels that
  reflect the actual scope; do not create new labels or apply unrelated issue-status
  labels during routine PR work. Set descriptive labels before `merge on pass`, because
  label edits also trigger CI. Descriptive labels do not authorize merging.
- Iterate on the draft without `merge on pass`. Regular checks
  run on updates; the full Docker E2E suite starts when `merge on pass` is added and on later
  pushes while it remains. See `docs/ci.md` for repository setup and commands.
- An unlabeled PR deliberately fails `validation`; require that check in branch protection
  so skipped E2E cannot permit merging. `merge on pass` means functionality and design are
  approved and authorizes merging once required checks pass.
- After the user approves functionality and design for merging, update the PR branch with
  current `main`, mark it ready and add `merge on pass`. Fix failures with the label left in
  place, then merge or enable auto-merge. If a fix changes the approved functionality or
  design, disable pending auto-merge, return the PR to draft, remove the label and obtain
  renewed approval. Keep the branch up to date as required checks rerun.
  The local `./scripts/dev.sh check` requirement still applies.
- Write PR descriptions for a reviewer who has not seen the conversation. Lead with the
  feature, improvement or fix and what it enables or changes. Include motivation or a
  before/after example when useful; a linked issue is optional.
  Summarize the final scope, relevant validation (passed, failed or still pending) and
  material limitations. Scale detail to the change: simple PRs need only a short paragraph
  plus validation. Use a Conventional Commit title, update the title/description when scope
  changes and use `.github/pull_request_template.md` for the body, including when creating
  PRs through a CLI or API. Fill its sections, remove instructional comments and omit empty
  optional review notes. Omit conversation history or abandoned approaches unless they
  explain a review-relevant tradeoff. Report screenshots or recordings for visual changes
  when available; link relevant issues and docs.

### Working in parallel

- Work in the checkout or worktree you are started in. Agents must not create or switch
  to their own worktrees unless the user explicitly asks them to. Run `./scripts/dev.sh up`
  from the assigned checkout when needed.
- Only one agent should change the database schema at a time (Drizzle migrations are
  numbered; see `WORKTREES.md`).
- When asked to merge a worktree into `main`, merge through its GitHub PR after required
  checks pass and the branch is up to date. Then fast-forward the primary checkout's
  `main` from its configured upstream, after checking its working tree. Never force-push
  `main` or bypass its required PR/check rules.
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

### API compatibility

- Read [ADR 0013](docs/decisions/0013-api-compatibility.md) when changing API requests,
  responses, synced shapes, note encoding or write/replay behavior. Review old client → new
  server **and** new client → old server; shared TypeScript types only check one build.
- Keep `API_PROTOCOL_VERSION` and `SUPPORTED_API_PROTOCOLS` in
  `packages/shared/src/protocol.ts` unchanged for UI changes, compatible fixes and additions
  with working fallbacks. No bump is required per push or release. A new client depending on
  an added endpoint/field without a fallback also changes compatibility.
- For an incompatible contract, increment the client protocol and server maximum. Raise the
  minimum when old clients cannot work; keep it lower only with implemented, tested support
  for every protocol in the range. Add boundary/mixed-version tests, document the decision
  and upgrade order, and use a breaking Conventional Commit. Do not infer compatibility
  from SemVer, a Git hash or the database migration number.
- Shape column changes also require the collection's `schemaVersion` bump. Changes to queued
  write formats or persisted note content need a lossless device migration/adapter; the
  protocol gate and schemaVersion do not migrate the outbox. Never clear local data or
  classify protocol rejection as a permanent write failure to resolve incompatibility.
- New data routes are gated by default. Use `compatibleFetch` for client REST/attachment
  requests and `compatibleShapeFetch` for Electric. Keep bootstrap/auth/update metadata and
  GET/HEAD byte-download contracts backward compatible; do not add mutation exemptions.

### General

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
- A build with no `CATCH_CHANNEL` is the `dev` channel (`scripts/build-channel.ts`, ADR 0009).
  On Android it is the Catch Dev app, `org.iloni.catchnotes.dev`, so development installs sit
  beside the released stable and preview apps instead of replacing them.
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
- Server backups (ADR 0012, `apps/server/src/backups`, Settings > Admin > Backups) are
  admin-only server state, not a synced collection: `lib/serverBackups.ts` makes plain
  requests. Their routes sit in the admin routes behind `requireAdmin`, except the download
  link, which carries a ticket and is mounted ahead of that guard in `app.ts`. A restore truncates and
  reloads the live tables in one transaction and never drops them, because Electric follows
  tables by identity; while it runs, every `/api` route but the health check answers 503.
  The backup code names no tables beyond counting rows for display, so a new table needs no
  change there. `POSTGRES_MAJOR` in the Dockerfile must follow the postgres image's version.
- `db/migrate` backs up the database before migrating when migrations are pending, so a
  dev stack collects `update` backups too; they live in the `backup_data` volume.
- Importers (Settings > Data Management) read exports on the device and add notes with
  `importNotes`, giving each a UUIDv7 derived from its source so importing again skips it
  (`importedNoteId`, ADR 0008). Read archives with `lib/zip.ts`, which never loads a whole file.
- The dev server has no service worker, so a page cannot load code offline in development.
  E2E tests for offline behavior block `/api` instead, or warm lazy chunks before going offline.
- E2E setup goes through `e2e/helpers.ts`: `signUp` makes the account through the API, and
  `seedNotes` adds the notes a test is not about writing. An element is visible before its
  animation ends, so a raw pointer gesture (`page.mouse`, CDP touch) first waits for its target
  to arrive (`settledBox`, `openDeck`, `waitForPageTransition`). A CDP touch lifted while still
  moving is a fling to Chrome, which drops the click of the next tap; rest before `touchEnd`.
- An E2E test that only uses `request` is tagged `@api` and runs once in the `api` project
  instead of once per layout. A test of behavior no layout changes (sync, the outbox,
  importers) skips one layout with `test.skip(isMobile, reason)`, provided another test in the
  file still drives the same screens on both.
- `pnpm check` on a machine without FFmpeg or the Postgres client tools skips the tests that
  need them; `./scripts/dev.sh check` and CI's stack run them.
- Traces slow every E2E test, so only the rerun of a failed test records one
  (`playwright.config.ts`). A test that passes on its rerun is reported as flaky, which fails CI.
