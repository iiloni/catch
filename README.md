# <img src="apps/web/public/icon.svg" alt="" width="40" height="40" /> Catch

A self-hosted, offline-first note-taking app in the spirit of Google Keep, available as a
web app (installable PWA) and a native Android app.

## Self-hosting

```bash
cp .env.example .env   # set BETTER_AUTH_SECRET, BETTER_AUTH_URL, POSTGRES_PASSWORD, ELECTRIC_SECRET
docker compose up -d --build
```

The app listens on port 3000 (`CATCH_PORT` to change it). Put it behind HTTPS; the Android
app requires it. The first account you create becomes the instance admin, and sign-up then
closes: set `REGISTRATION=open` while other people make their accounts. Set `TRUSTED_PROXIES`
to your reverse proxy's address so the sign-in rate limit counts each visitor rather than
the proxy (see `.env.example`).

Electric uses its pinned prebuilt image when available. If Docker Hub cannot supply it,
Compose builds the same release from a pinned upstream Git commit; the first build takes
longer and needs access to GitHub and the upstream build dependencies.

For published Docker images, signed Android APKs, stable/preview channels, and a production
configuration kept outside this checkout, see [Releasing and deployment](docs/releases.md).

Attachments live in the `attachment_data` Docker volume. Set `CATCH_ATTACHMENTS_MOUNT`
to a host directory for a bind mount, writable by the container's `node` user (UID 1000).
Files can be up to 100 MiB, and each account up to 10 GiB in all (`ATTACHMENT_QUOTA_MB`);
uploads made offline stay on the device and resume when it reconnects.

### Backups and updates

Admins back up and restore the whole server (database and attachments) in Settings > Admin >
Backups, and can schedule a daily backup there. Backups go to the `backup_data` volume;
set `CATCH_BACKUPS_MOUNT` to a directory on another disk so they outlive this one.

```bash
./scripts/update.sh                  # back up the database, pull, rebuild, restart
./scripts/backup.sh create           # a full backup from the host
./scripts/backup.sh restore <backup> # also works when Catch cannot start
```

The server also backs up its database by itself before a new version migrates it. See
[Server backups](docs/backups.md).

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

For PR iteration, label-triggered E2E, required merge checks and GitHub auto-merge setup,
see [Pull requests and CI](docs/ci.md).

## Android

For day-to-day work, open the dev stack's URL in Chrome on the phone (over Tailscale). It is
the same code the app runs, with hot reload, and `chrome://inspect` gives you DevTools.

To test inside the native app, connect the phone with USB or wireless debugging and run:

```bash
./scripts/dev.sh android         # the phone reaches the stack over Tailscale
./scripts/dev.sh android --usb   # or through adb, without Tailscale on the phone
./scripts/dev.sh android --static # bundled APK without hot reload
```

The command starts this worktree's stack and installs the Catch Dev app, whose WebView
loads its Vite server, so web changes hot-reload on the phone. It is a separate app from
the released Catch and Catch Preview, and the command builds it whatever `CATCH_CHANNEL`
is set to. Rerun it only after native changes
(Capacitor plugins or config, anything under `apps/web/android`) or to point the app at
another worktree. The app needs the stack running (and, with `--usb`, the device connected)
while you use it. `chrome://inspect` works here too.

With `--static`, the command rebuilds and bundles the web app, installs the APK on the
connected device, and exits. The frontend runs from the APK while API requests still reach
this worktree's HTTP server over Tailscale. Keep the stack running, and rerun the command
to include later web or native changes. `--static --usb` reaches the same backend via adb.
The bundled app uses a different WebView origin from live reload, so it has its own login
and local web data. Capacitor options such as
`--target <device-id>` can be passed in either mode.

The requirements are a JDK 21 and the Android SDK on the host (`JAVA_HOME`, `ANDROID_HOME`).
Use `adb pair` and `adb connect` for a wireless connection.

A standalone build bundles the web app and asks for your server URL on first launch:

```bash
pnpm --filter @catch/web android:sync
pnpm --filter @catch/web android:open   # or: cd apps/web/android && ./gradlew assembleDevDebug
```

Dev is the default Android flavor. It installs as Catch Dev (`org.iloni.catchnotes.dev`)
beside the released Catch and Catch Preview apps and is never distributed. Stable and
preview release builds read their version and signing credentials from the environment
(see [Releasing and deployment](docs/releases.md)).

The approved Gentle Drop masters and exact values live in `branding/`, with the icon-only
preview extension in `branding/preview/`. Run `./scripts/generate-brand-assets.sh all` with
ImageMagick (SVG support) and Python 3 to regenerate both channels, or pass `stable` (the
default) or `preview` to regenerate one. Check preview derivation with
`python3 branding/preview/derive-preview-icons.py --check`.
See [Brand assets](docs/branding.md) for sizes, shared Android layers, integrity checks,
and channel selection. UI colors and theme colors stay the same in both channels.
