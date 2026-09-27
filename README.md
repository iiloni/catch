# Catch

A self-hosted, offline-first note-taking app in the spirit of Google Keep, available as a
web app (installable PWA) and a native Android app.

## Self-hosting

```bash
cp .env.example .env   # set BETTER_AUTH_SECRET, BETTER_AUTH_URL, POSTGRES_PASSWORD, ELECTRIC_SECRET
docker compose up -d --build
```

The app listens on port 3000 (`CATCH_PORT` to change it). Put it behind HTTPS; the Android
app requires it. The first account you create becomes the instance admin.

## Development

Requires Docker and, for end-to-end tests and editor support on the host, Node 24 and pnpm
(`corepack enable`).

```bash
./scripts/dev.sh up    # isolated stack for this checkout; prints its URL
./scripts/dev.sh check # lint, typecheck, test, build
pnpm install && ./scripts/dev.sh e2e
```

Each Git worktree gets its own stack, so several branches can run side by side; see
[WORKTREES.md](WORKTREES.md). See [AGENTS.md](AGENTS.md) for architecture and conventions,
and [docs/decisions](docs/decisions) for why the stack looks the way it does.

## Android

```bash
pnpm --filter @catch/web android:sync
pnpm --filter @catch/web android:open   # or: cd apps/web/android && ./gradlew assembleDebug
```

On first launch the app asks for your server URL.
