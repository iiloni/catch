# Next steps

Where Catch stands after the rebuild, and what is still open. The long-term feature list lives
in [docs/roadmap.md](docs/roadmap.md); this file tracks the immediate work and loose ends.
Delete items as they land.

## Where things stand (2026-09-27)

- The baseline from `catch-old` is ported: BlockNote editor, colors, pins, archive, trash with
  undo, deck grid and board, gallery sorting, and theme switching. Notes are stored as
  BlockNote JSON.
- The web app, API, and sync (Electric + TanStack DB) run in a Docker stack per worktree. CI
  runs `check` and the Playwright e2e suite on every push to `main`.
- Android builds (`./gradlew assembleDebug`), and `./scripts/dev.sh android` installs a
  live-reload debug app on a connected phone.

## Housekeeping

- [ ] Move the local checkouts into the worktree layout:
      `mv catch catch-old && mkdir catch && mv catch-new catch/catch-main`.
      Then run `./scripts/worktree.sh init` in `catch-main` if `.env.worktree` needs
      regenerating.
- [ ] Try `./scripts/dev.sh android` on the phone. It has not been run on a real device yet:
      pair with wireless debugging, check hot reload, login, sync, and board drag on touch.
- [ ] Bump `pnpm/action-setup` in `.github/workflows/ci.yml` once a version targets Node 24.
      CI warns that the current one is forced from Node 20.

## Next features

In rough priority order.

1. **Offline persistence.** Persist TanStack DB collections locally and queue writes made
   while offline. This is the core promise of the app. Today changes are optimistic but need
   a connection, and after an offline reload there are no notes to show. Check TanStack DB's persistence
   and offline-transactions packages first. IDs are already generated on the client.
2. **Search.** Keyword search already has a generated `tsvector` and GIN index on the server.
   It still needs a search UI and client-side keyword search over the synced collection for
   offline use. Then add semantic search and fusion as described in
   [docs/decisions/0002-search.md](docs/decisions/0002-search.md).
3. **Deploying for daily use.** Run the production `docker-compose.yml` behind HTTPS (for
   example Tailscale Serve or Caddy), then install the PWA and a standalone Android build
   against it. The standalone Android app needs the server on HTTPS.
4. **Markdown import and export.** Convert with BlockNote's Markdown helpers, and consider
   importing `catch-old` data and Google Keep exports (Takeout) as well.
5. **AI summaries of links.** Link previews are in (ADR 0006); summaries are the last
   `catch-old` feature not ported. Add a nullable `summary` to `link_previews`, fill it from the
   preview queue through an optional OpenAI-compatible provider (off by default), and show it
   as a disclosure on the preview card.
6. **Android share target.** Receive text and links from other apps and create notes from
   them.
7. **Labels**, **user-defined board columns**, and **manual reordering** (drag within the
   gallery and within board columns; only moves between columns work today).

## Known gaps and tech debt

- **Bundle size.** BlockNote is a lazy-loaded chunk of about 975 KB (290 KB gzipped), and the
  app shell is about 506 KB. Vite warns about both. Look at splitting the auth and router
  code, or trimming BlockNote, before it grows.
- **Android release pipeline.** There is no signed release build yet. Options: have CI build
  a signed APK and attach it to a GitHub release, then install and update it with Obtainium.
- **E2E coverage.** Playwright runs Chromium on desktop and with an Android-sized viewport.
  Touch dragging on the board and the native app are only tested by hand. Add
  offline-behavior tests together with offline persistence.
- **TanStack DB is pre-1.0.** Keep its usage in `apps/web/src/lib/collections.ts` and the
  route files so upgrades stay contained.
- **Link preview assets are never deleted.** Thumbnails and icons in `link_preview_assets`
  are shared by content hash; add a cleanup of ones no preview references.
- **Migrations.** Only one agent or worktree should change the database schema at a time
  (see [WORKTREES.md](WORKTREES.md)).
