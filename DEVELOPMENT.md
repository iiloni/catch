# Developing Catch

This guide is for people changing Catch's code. It covers the development environment,
tests, the Android app and how changes reach `main`.

> [!NOTE]
> Catch is not accepting external contributions at the moment. You are welcome to read the
> code, run it and fork it under the [MIT license](LICENSE).

For how the code is organized and the conventions it follows, read [AGENTS.md](AGENTS.md).
[docs/decisions](docs/decisions) records why the stack looks the way it does.

## What you need

- Docker, which runs the app, Postgres and Electric.
- Node 24 and pnpm (`corepack enable`) on the host, for end-to-end tests and editor support.
- For the Android app only: JDK 21 and the Android SDK (`JAVA_HOME`, `ANDROID_HOME`).

## Start the app

```bash
./scripts/dev.sh up
```

This builds and starts a stack for this checkout and prints its URL. Hot reload is on.
Sign in with `admin@example.com` / `adminadmin` or `user@example.com` / `userpassword`.

Each Git worktree gets its own stack with its own database and port, so several branches can
run side by side. See [WORKTREES.md](WORKTREES.md).

`./scripts/dev.sh help` lists every command, including `logs`, `psql`, `shell`, `seed` and
`reset`.

## The public site

The site at `catchnotes.site` lives in `apps/site`: the marketing page, the documentation
(`content/docs`) and the changelog. It is not part of the stack, so start it when you work
on it:

```bash
./scripts/dev.sh site          # prints its URL; hot reload is on
./scripts/dev.sh screenshots   # recapture its pictures of the app from the running stack
```

`./scripts/dev.sh check` builds it with everything else. [ADR 0020](docs/decisions/0020-public-site.md)
explains how it is put together.

## Check your changes

```bash
./scripts/dev.sh check   # lint, typecheck, unit tests, build
pnpm format              # apply formatting and import sorting
```

`check` must pass before a change is finished.

### End-to-end tests

Playwright runs on the host against this checkout's stack. Set it up once:

```bash
pnpm install
pnpm exec playwright install chromium
```

Then run the specs your change affects:

```bash
./scripts/dev.sh e2e e2e/auth.spec.ts --workers=1
./scripts/dev.sh e2e e2e/auth.spec.ts --grep "signing in" --workers=1
```

The full suite is slow and runs in CI before a merge, so it is not a routine local check.
Runs take a lock shared by all worktrees on the machine and need `flock`.

## Pull requests

Changes go through a draft pull request against `main`. Commits and PR titles use
[Conventional Commits](https://www.conventionalcommits.org/), because release notes are
generated from them.

[Pull requests and CI](docs/ci.md) explains the labels that request the full test suite and
approve a merge, and the checks a PR must pass. [AI code review](docs/ai-reviews.md) covers
the optional review.

## Android

For day-to-day work, open the dev stack's URL in Chrome on the phone (over Tailscale). It is
the same code the app runs, with hot reload, and `chrome://inspect` gives you DevTools.

To test inside the native app, connect the phone with USB or wireless debugging (`adb pair`
and `adb connect`) and run:

```bash
./scripts/dev.sh android          # the phone reaches the stack over Tailscale
./scripts/dev.sh android --usb    # or through adb, without Tailscale on the phone
./scripts/dev.sh android --static # bundled APK without hot reload
```

The command starts this worktree's stack and installs the Catch Dev app, whose WebView
loads its Vite server, so web changes hot-reload on the phone. Catch Dev
(`org.iloni.catchnotes.dev`) is a separate app from the released Catch and Catch Preview,
is never distributed, and is what the command builds whatever `CATCH_CHANNEL` is set to.

Rerun the command only after native changes (Capacitor plugins or config, anything under
`apps/web/android`) or to point the app at another worktree. The app needs the stack running
(and, with `--usb`, the device connected) while you use it. `chrome://inspect` works here
too. Capacitor options such as `--target <device-id>` can be passed in either mode.

### Static installs

With `--static`, the command rebuilds and bundles the web app, installs the APK on the
connected device, and exits. The frontend runs from the APK while API requests still reach
this worktree's HTTP server over Tailscale, or over adb with `--static --usb`. Keep the stack
running, and rerun the command to include later web or native changes.

The bundled app uses a different WebView origin from live reload, so it has its own login
and local web data.

### Standalone builds

A standalone build bundles the web app and asks for your server URL on first launch:

```bash
pnpm --filter @catch/web android:sync
pnpm --filter @catch/web android:open   # or: cd apps/web/android && ./gradlew assembleDevDebug
```

Stable and preview release builds read their version and signing credentials from the
environment; see [Releasing and deployment](docs/releases.md).

## Brand assets

The approved icon masters and exact values live in `branding/`, with the preview channel's
icons in `branding/preview/`. Regenerating them needs ImageMagick (with SVG support) and
Python 3:

```bash
./scripts/generate-brand-assets.sh all   # or: stable (the default), preview
python3 branding/preview/derive-preview-icons.py --check
```

[Brand assets](docs/branding.md) covers sizes, shared Android layers, integrity checks and
channel selection.

## Releasing

`./scripts/release.sh` tags a commit locally, and pushing that tag starts the Docker image
and Android builds. [Releasing and deployment](docs/releases.md) covers channels, versions,
signing and release notes.
