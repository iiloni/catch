# Releasing and deployment

Settings > Update shows the current server version and its release channel. On Android it
also shows the installed app version and offers an update to the server's exact published
release when the app is behind and uses the same channel. The first launch or resume after
an update is detected shows a dismissible prompt; Settings and Update keep an indicator
until the app catches up. The download is verified before Android asks to install it. Stable,
preview and development apps remain separate; development builds have no release updater.

Catch builds Docker images and signed Android APKs from version tags. Personal production
Compose files, domains, credentials, and signing keys stay outside the repository.

Client/server API compatibility uses a separate protocol number and server-supported range
([ADR 0013](decisions/0013-api-compatibility.md)), independent of release versions. When the
protocol is incompatible, sync pauses while local notes and queued writes remain on the
device. Settings > Update says whether the app or server needs updating; compatible version
differences do not block sync. Protocol 1 introduces this gate with no legacy-client fallback:
sync or export changes before updating a pre-protocol client, and manually install the new
Android app for this release. Future breaking release notes must state the supported protocol
range and upgrade order. Ordinary releases and pushes do not require a protocol bump.

## Channels and versions

| Channel | Git tag | Exact image tag | Moving image aliases | Android application |
| --- | --- | --- | --- | --- |
| Stable | `v0.4.1` | `0.4.1` | `stable`, `latest` | Catch (`org.iloni.catchnotes`) |
| Preview | `v1.0.2-preview` | `1.0.2-preview` | `preview` | Catch Preview (`org.iloni.catchnotes.preview`) |
| Dev | none | none | none | Catch Dev (`org.iloni.catchnotes.dev`) |

The image name is `ghcr.io/<repository owner>/<repository name>`, lowercased. Stable and
preview advance independently. Preview never changes the stable aliases or GitHub's latest
stable release. Older releases can be published as backports without moving aliases back.

Each preview has its own core `MAJOR.MINOR.PATCH` version. The `-preview` suffix selects
the channel; there is no separate counter. For example, advance from `0.3.0-preview` to
`0.3.1-preview` for a fix or `0.4.0-preview` for a feature. Before 1.0, SemVer allows the
compatibility contract to change; from 1.0 onward, use major for breaking changes, minor for
compatible features, and patch for compatible fixes.

For example, stable can stay on `0.3.3` while preview advances through
`0.4.0-preview`, `0.4.1-preview`, and `0.4.2-preview`. When the final preview is ready,
tag its tested commit as `v0.4.2` to promote it. You do not need stable `0.4.0` or `0.4.1`
releases first. Alternatively, while newer patch work continues on main, you can promote
the earlier commit behind `v0.4.1-preview` as `v0.4.1`; newer work and the preview channel
stay where they are. Use `./scripts/release.sh stable promote v0.4.1-preview` for that promotion.
Always remove the preview suffix from the tested version, and test another preview if
you change that commit before releasing it.

Only stable tags and `-preview` tags are accepted. Components cannot have leading zeroes.
Numbered preview suffixes, other suffixes, and build metadata are intentionally unsupported. Never
move or reuse a published tag; tag a new version instead. Use Conventional Commits for
commit messages, but choose release versions explicitly.

## Workflows

- `ci.yml`: lint, typecheck, unit tests (including release policy), web/API builds, and E2E.
  Runs on pushes to main, pull requests to main, and manual dispatch. Runs for the same
  commit queue without cancellation and reuse a previous pass instead of testing again.
  A release reuses successful CI for its exact tagged commit, requiring `check` and both
  E2E projects to have succeeded. It waits up to 30 minutes for queued or running CI.
  If no run appears within a minute, it requests CI on the release tag; this covers an
  intermediate commit in a batch push that only tested the tip. Without a previous pass,
  failed or canceled CI blocks release until CI is rerun successfully. No release runs
  its own copy of E2E.
- `tag-release.yml`: manual channel and version-bump inputs call `scripts/release.sh`,
  create its annotated tag on GitHub, then dispatch `release.yml` on that tag. Requests
  queue without cancellation and fetch full history and tags before choosing the next version.
  Preparation runs the default branch's helper and dependencies at an immutable commit
  with read-only permissions, using a separate checkout of the selected release target.
  A separate job with write permissions creates the tag and dispatches Release through
  the GitHub API, without checking out or executing repository code.
  Requires `RELEASES_ENABLED=true` before creating any tag.
- `release.yml`: a pushed `v*` tag or manual dispatch on a release tag validates the version.
  Branch refs, including branches named like version tags, are rejected before checkout.
  Builds and publishing proceed only when the Actions repository variable `RELEASES_ENABLED`
  is exactly `true`.
  Release runs are queued, with no cancellation. The version job checks
  Android signing secrets before either build can start; missing credentials block both.
- After CI passes, signed APK and Docker image builds run in parallel. APK builds use
  Node 24, JDK 21, SDK 36, and the Gradle wrapper. The Docker job builds the production
  Dockerfile for `linux/amd64` and `linux/arm64`, and pushes only the exact version.
  Once both artifacts are ready, the publishing job uploads the APK and
  checksum to a draft release, updates the appropriate image aliases, and publishes the
  release. Preview GitHub Releases are marked as prereleases.

The release notes list what changed (see [Release notes and changelog](#release-notes-and-changelog)),
then record the exact image, its digest, the source commit, and the Android version code.
The version job generates the notes into the run summary before any build starts, so a
release whose notes cannot be generated stops there; the publishing job generates them
again for the release body, including when a rerun edits an existing draft. Both jobs
fetch full history and tags for this. There is no deployment job. Actions artifacts expire after seven days; APKs
attached to a published GitHub Release remain available there.

## One-time GitHub configuration

1. Make the repository public when ready. Standard GitHub-hosted runner compute is free for
   public repositories; larger runners and excess storage have separate billing rules.
2. Allow the pinned actions used by these workflows in Settings > Actions > General.
   Jobs declare the required `contents: write` and `packages: write` permissions themselves;
   the built-in `GITHUB_TOKEN` creates tags and publishes releases and images, with no
   personal access token. Manual tagging also declares `actions: write` to dispatch the
   existing release workflow.
3. Configure the four signing secrets below in Settings > Secrets and variables > Actions.
4. Once signing is ready and you intend to release, set the Actions **repository variable**
   `RELEASES_ENABLED` to `true`. Leaving it absent or false keeps all release builds off.
5. After the first image is published, open the account's Packages > Catch > Package settings
   and change visibility to Public. Repository visibility does not automatically make a new
   GHCR package public. Anonymous production pulls work after this change.

Protect main with the CI `check`, `e2e (desktop)` and `e2e (android)` status checks, and use
a tag ruleset for `v*` to limit release tag creation and prevent deletion or modification.
These are GitHub settings;
the workflow files do not change them. The tag ruleset must permit GitHub Actions to create
release tags for manual tagging to work. If an existing GHCR package is already associated
with another repository, grant this repository Actions write access to that package.

## Android signing setup

Create a persistent signing key outside the checkout and keep a secure backup of the key,
alias, and password. Updates require the same signing key. For example, with JDK 21:

```bash
umask 077
mkdir -p ~/.local/share/catch-signing
keytool -genkeypair -storetype PKCS12 \
  -keystore ~/.local/share/catch-signing/release.keystore \
  -alias catch -keyalg RSA -keysize 3072 -validity 10000
```

This prompts for the password and certificate details. With PKCS12, use the keystore
password as the key password too. Configure these repository Actions secrets:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64 encoding of the keystore file |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | `catch`, if using the example above |
| `ANDROID_KEY_PASSWORD` | Key password (same as store password for that PKCS12 key) |

With the GitHub CLI, the file secret can be set without printing it:

```bash
base64 -w 0 ~/.local/share/catch-signing/release.keystore | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEYSTORE_PASSWORD
gh secret set ANDROID_KEY_ALIAS
gh secret set ANDROID_KEY_PASSWORD
```

The other commands prompt for their values. Do not commit the key or passwords. CI decodes
the key into a temporary file and removes it after the Android job; Gradle receives signing
values through the environment and configuration caching is disabled for the release build.

The APK's `versionName` is the full tag without `v`. Its `versionCode` is the release
workflow's run number, shared across the two flavors. Publish forward releases in order,
waiting for the previous release to finish. Keep `.github/workflows/release.yml` and its
workflow identity intact: resetting the run sequence requires planning a higher version-code
baseline. A rerun keeps its original code; retry an interrupted older release before making
newer releases. Published releases cannot be rebuilt and overwritten.

Stable, preview and dev install together and keep separate local notes, accounts, and
server URLs. A device that still has a debug build from before the dev channel holds it
under the stable id with a debug key, so the first signed stable installation needs a
one-time uninstall. Sync or export local notes first. Signed releases update normally. Download updates from GitHub
Releases; an automatic Android updater is not included.

Local release builds use `CATCH_VERSION`, `CATCH_VERSION_CODE`, `ANDROID_KEYSTORE_PATH`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. Missing values
fail the release build. Debug builds do not require them. `assembleDevDebug` is the usual
development APK; `assembleStableDebug` and `assemblePreviewDebug` build debug-signed copies
under the released ids, which cannot be installed over a signed release. The dev flavor
has no release build.

The workflow forwards the tag parser's channel as build-only `CATCH_CHANNEL` to Android
web sync and the Docker build. The Docker build also receives the version as `CATCH_VERSION`,
which the server records in its backups and uses to notice an update. Local preview sync uses
`CATCH_CHANNEL=preview pnpm --filter @catch/web android:sync` before building the preview
flavor; an unset channel is dev. See [Brand assets](branding.md) for regeneration
and the channel-specific icon paths. Application UI and theme colors are shared unchanged.

## Creating a release

After merging the workflows and configuring signing and `RELEASES_ENABLED`, open
**Actions > Tag release > Run workflow**. Select the branch to release (normally `main`),
choose `channel` (`preview` or `stable`) and `version_type` (`patch`, `minor` or `major`),
then run it. It tags the selected ref's commit at dispatch time using the same version
rules as the local helper below, creates the tag on GitHub and starts the **Release**
workflow.
The Release workflow keeps its existing CI gate, signing checks and Android version-code
sequence. The GitHub token's tag creation does not start workflows itself, so Tag release
explicitly dispatches Release on the new tag.

For example, run it from the CLI with:

```bash
gh workflow run tag-release.yml --ref main -f channel=preview -f version_type=minor
```

Wait for the Release workflow to finish before creating another release. If a tag was
created on GitHub but dispatch failed, use **Actions > Release > Run workflow** on that
existing tag or `gh workflow run release.yml --ref <tag>`. If Release already started and failed, rerun
that Release run to preserve its Android version code. Rerunning Tag release creates
another version. Use the local helper for preview promotion.

The local helper requires Node 24+ and installed dependencies (`pnpm install`). It creates
an annotated tag on the latest commit (`HEAD`), and never fetches or pushes. Ordinary bumps
require a clean checkout; `--dry-run` can inspect the result while changes are uncommitted.

The baseline is the highest supported stable **or** preview tag reachable from HEAD. For
example, with stable `v0.3.3` and preview `v0.4.1-preview` in the history, `preview patch`
produces `v0.4.2-preview`, and `stable patch` produces `v0.4.2`. Major and minor bumps reset
lower components. With no tags, the baseline is `0.0.0`. Tags on unrelated branches do not
affect the bump, so a backport branch uses its own history. Existing tags are never overwritten.

Fetch tags yourself before choosing a version if other maintainers may have released:

```bash
git fetch origin --tags
./scripts/release.sh preview minor --dry-run
./scripts/release.sh preview minor
```

Use `stable` in place of `preview` for a stable bump. These commands only create local tags.
To promote a tested preview, preserve its version and commit using `promote` rather than
bumping again:

```bash
# Promote the highest preview tag on HEAD:
./scripts/release.sh stable promote
# Or promote an earlier preview without switching branches or changing newer work:
./scripts/release.sh stable promote v0.4.1-preview --dry-run
./scripts/release.sh stable promote v0.4.1-preview
```

Promotion can run with uncommitted changes because it tags an existing preview commit.
No version edit or separate release branch is required.

First merge the workflow setup and configure signing and `RELEASES_ENABLED`. When you are
ready to trigger real builds, push the exact tag printed by the helper, for example:

```bash
git push origin v0.4.1
```

Pushing the tag triggers the release workflow; merging ordinary code does not publish
images or APKs. Leave `RELEASES_ENABLED` absent until you intend to enable release builds.

Follow the Release workflow in Actions. An interrupted unpublished release can be retried
using Re-run jobs; the draft and assets can be resumed. An Android build failure may leave
an exact image, and a failed publication may leave an exact image or draft release, but
stable/preview aliases only advance after both build jobs succeed. Once published, choose
a new version for any changes.

## Release notes and changelog

There is no committed `CHANGELOG.md`. The changelog is derived from release tags and commit
history whenever it is needed ([ADR 0017](decisions/0017-derived-changelog.md)), by
`scripts/changelog.ts`:

```bash
git fetch origin --tags
./scripts/release.sh changelog v0.4.1            # notes for one release
./scripts/release.sh changelog                   # unreleased commits on HEAD
./scripts/release.sh changelog --channel stable  # what a stable release of HEAD would list
./scripts/release.sh changelog --all             # every release, newest first
./scripts/release.sh changelog --all --json      # the same as data
```

It only reads local tags and history: it never fetches, tags or writes, and it refuses a
shallow clone. Outside Actions the repository for links comes from the `origin` remote, or
`--repo owner/name`.

- **Range.** A preview covers the commits since the highest lower tag, stable or preview,
  reachable from it. A stable release covers the commits since the highest lower stable
  tag, so it lists everything in the previews it supersedes; promoting an earlier preview
  gives that full list for the promoted commit and none of the newer work. The first
  release covers its whole history. Tags on unrelated branches are ignored, as they are
  for version bumps.
- **Entries** come from commits, not pull requests, so direct commits to main appear too.
  Merge commits are skipped in favour of the commits they bring in. An entry links to its
  pull request when the subject ends in `(#N)`, as squash merges do, and to the commit
  otherwise.
- **Grouping.** Commits with `!` or a `BREAKING CHANGE:` footer come first, with the
  footer's text; then `feat`, `fix` and `perf`. Everything else, including subjects that
  are not Conventional Commits, is collapsed under "Other changes". A commit subject is
  therefore release-note text: write it for someone reading the notes.
- **Compatibility.** `API_PROTOCOL_VERSION` and `SUPPORTED_API_PROTOCOLS` are read from
  `packages/shared/src/protocol.ts` at both ends of the range. When they differ, the notes
  state the old and new protocol and supported range and the upgrade order they imply.
  Keep those two declarations as plain literals; the generator reads the source text, and a
  unit test fails if it no longer can. Add anything else an upgrade needs to the
  `BREAKING CHANGE:` footer.
- **Changelog link.** Each body ends with a link for the release's range. It is GitHub's
  compare view until `CHANGELOG_BASE_URL` in `scripts/changelog.ts` is set; after that it
  is `<base>/<version>`, for example `https://catchnotes.site/changelog/0.4.1`.

`--json` prints one release, or with `--all` this document:

```jsonc
{
  "schemaVersion": 1,            // bumped for incompatible changes to this output
  "repository": "iiloni/catch",
  "releases": [                  // every release tag, newest version first
    {
      "tag": "v0.4.1",
      "version": "0.4.1",
      "channel": "stable",       // or "preview"
      "date": "2026-10-03T13:43:48-04:00",       // when the tag was created
      "commit": "<sha>",
      "previous": "v0.3.3",      // start of the range; null for a first release
      "promotedFrom": "v0.4.1-preview",          // preview on the same commit, or null
      "previews": ["v0.4.0-preview", "v0.4.1-preview"],  // folded into a stable release
      "urls": { "release": "...", "compare": "...", "changelog": "..." },
      "protocol": {
        "from": { "version": 1, "min": 1, "max": 1 },    // null when the file is absent
        "to": { "version": 2, "min": 2, "max": 2 },
        "changed": true,
        "summary": "API protocol: app 1 → 2; ..."         // null unless changed
      },
      "breaking": true,
      "sections": [              // non-empty groups in reading order
        {
          "id": "breaking",      // breaking | features | fixes | performance | other
          "title": "Breaking changes",
          "entries": [
            {
              "commit": "<sha>",
              "date": "2026-10-03T12:00:00-04:00",
              "subject": "feat(tags)!: add nested tags (#3)",
              "type": "feat",    // null when the subject is not a Conventional Commit
              "scope": "tags",
              "description": "add nested tags",
              "breaking": true,
              "breakingNote": "clients and servers now require API protocol 2.",
              "pr": 3,
              "url": "https://github.com/iiloni/catch/pull/3"
            }
          ]
        }
      ]
    }
  ],
  "unreleased": null             // same shape with null tag, version and date, when HEAD has commits after its latest tag
}
```

Each entry is in exactly one section. Text fields are commit text as written: a consumer
that renders them escapes them itself, as the Markdown output does.

Releases published before the generator keep their original bodies. To rewrite one, see
the output with `./scripts/release.sh changelog <tag>` and edit the release on GitHub.

## Production configuration outside the repository

Keep a standalone deployment directory on the server, for example `~/services/catch/`,
with `compose.yaml` and an owner-only `.env`. The server does not need a Git checkout.
Copy the generic `docker-compose.yml` and `.env.example` there as a starting point, then
replace the app's `build:` block with:

```yaml
image: ${CATCH_IMAGE:?Set CATCH_IMAGE}
```

Choose an exact release or channel alias in the server's `.env`:

```dotenv
CATCH_IMAGE=ghcr.io/OWNER/REPOSITORY:stable
BETTER_AUTH_URL=https://notes.example.com
BETTER_AUTH_SECRET=YOUR_RANDOM_SECRET
POSTGRES_PASSWORD=YOUR_RANDOM_PASSWORD
ELECTRIC_SECRET=YOUR_OTHER_RANDOM_SECRET
```

Use the actual lowercased image name. Generate the three credentials independently with
`openssl rand -hex 32`, and `chmod 600 .env`. Keep Postgres/Electric and their persistent
volumes from the generic Compose file. For Docker-based Traefik, remove the app's host
`ports:` mapping and add this to the app service (adapt the hostname and resolver):

```yaml
networks: [default, proxy]
labels:
  - traefik.enable=true
  - traefik.docker.network=proxy
  - traefik.http.routers.catch.rule=Host(`notes.example.com`)
  - traefik.http.routers.catch.tls=true
  - traefik.http.routers.catch.tls.certresolver=letsencrypt
  - traefik.http.services.catch.loadbalancer.server.port=3000
```

At the Compose file's top level, add:

```yaml
networks:
  default: {}
  proxy:
    name: proxy
    external: true
```

Only the app joins the external proxy network. Point DNS at the server and ensure the
Traefik router names are unique if you deploy more than one Catch instance.

Once the GHCR package is public, the production server needs no registry credentials:

```bash
cd ~/services/catch
docker compose pull --ignore-buildable
docker compose up -d --wait
curl --fail https://notes.example.com/api/health
```

Copy `scripts/backup.sh` and `scripts/update.sh` next to `compose.yaml` as well. From then
on `./update.sh` is the update: it backs up the database, pulls the image and waits for the
new version to be healthy. [Server backups](backups.md) covers both scripts.

Create your account before making a new instance generally accessible: the first account
becomes admin. Sign-up closes after it, and the admin invites other people with links from
Settings > Admin > Users. Setting `REGISTRATION=open` keeps sign-up open to anyone instead. Release channels do not change authentication.

For preview, use a separate Compose project, hostname, `.env`, and named volumes, selecting
`:preview`. It must have its own Postgres and Electric data rather than share production.

Keep the `backup_data` volume from the generic Compose file, or set `CATCH_BACKUPS_MOUNT`
to a directory on another disk. A new version backs up the database into it before migrating,
however the update was started, and admins make, schedule, download and restore full backups
in Settings > Admin > Backups. See [Server backups](backups.md), including how to go back
after a bad update. Keep copies of the backups and the `.env` credentials off the server, and
verify a restore before relying on it.

Migrations run on startup; reverting an image does not revert its database schema, which is
what the pre-update backup is for. Exact version tags or the image digest in release notes
let you control which build you deploy.
