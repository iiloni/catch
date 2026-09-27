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

Run from the repo root.

- `pnpm check`: lint, typecheck, unit tests, build. **Must pass before you finish.**
- `pnpm db:up`, then `pnpm db:migrate`: start Postgres + Electric in Docker and apply migrations.
- `pnpm dev`: API on :3000 and web on :5173 (Vite proxies `/api` to the API).
- `pnpm e2e`: Playwright tests (needs `pnpm db:up`; starts `pnpm dev` if it is not running).
- `pnpm db:generate`: create a migration after editing `apps/server/src/db/schema.ts`. Commit the generated SQL.
- `pnpm format`: apply Biome formatting and import sorting.
- `pnpm --filter @catch/web android:sync`: build the web app and copy it into the Android project.

Copy `.env.example` to `.env` for local development.

## How data flows

1. Clients read through **TanStack DB collections** (`apps/web/src/lib/collections.ts`), which
   Electric keeps in sync with Postgres.
2. Clients never talk to Electric directly. `GET /api/shapes/*` is an auth proxy that pins
   each shape to the signed-in user's rows and an explicit column list.
3. Writes are optimistic: the collection updates immediately, the mutation handler calls the
   REST API, and the API returns the Postgres `txid` so the optimistic state is dropped once
   Electric streams that transaction back.
4. IDs are UUIDv7 and are generated **on the client** so notes can be created offline.

When adding a synced table: add it to the Drizzle schema, generate a migration, add a Zod
schema to `packages/shared`, add a shape route with a user filter and a column allowlist, add
write routes that return `{ txid }`, then add a collection.

## Conventions

- TypeScript strict everywhere. No `any`; validate unknown data with Zod.
- Request and response shapes come from `packages/shared`. Do not redeclare them in an app.
- Style with Tailwind utilities and the tokens in `apps/web/src/styles.css`. Tokens already
  handle dark mode via `light-dark()`, so avoid `dark:` variants.
- Add UI primitives with `pnpm dlx shadcn@latest add <component>` from `apps/web`; they land
  in `src/components/ui` and are ours to edit.
- Feature components go in `apps/web/src/components/<Name>/<Name>.tsx` with a
  `<Name>.test.tsx` next to them.
- Design for touch first: no hover-only controls on mobile widths.
- Every Postgres query that touches user data filters by `userId`.
- Keep comments for the *why*; do not narrate the code.

## Gotchas

- `catch` is a Java keyword, so the Android application id is `org.iloni.catchnotes`.
- The Android app runs on `https://localhost`, a different origin than the server, so all
  clients authenticate with Better Auth bearer tokens (`set-auth-token` header), not cookies.
- Android blocks cleartext HTTP by default, so the Android app needs the server on HTTPS.
- TanStack DB is pre-1.0. Keep its usage inside `src/lib/collections.ts` and route files so
  upgrades stay contained.
