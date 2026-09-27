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

Requires Node 24, pnpm (via `corepack enable`) and Docker.

```bash
pnpm install
cp .env.example .env
pnpm db:up && pnpm db:migrate
pnpm dev               # http://localhost:5173
pnpm check             # lint, typecheck, test, build
pnpm e2e               # Playwright end-to-end tests
```

See [AGENTS.md](AGENTS.md) for architecture and conventions, and
[docs/decisions](docs/decisions) for why the stack looks the way it does.

## Android

```bash
pnpm --filter @catch/web android:sync
pnpm --filter @catch/web android:open   # or: cd apps/web/android && ./gradlew assembleDebug
```

On first launch the app asks for your server URL.
