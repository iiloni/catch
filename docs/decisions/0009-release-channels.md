# 0009: Tagged releases and channels

Status: accepted (2026-09-30)

## Context

Catch needs public container images and installable Android releases, while each operator's
production Compose configuration and credentials live outside the source checkout. Stable
and preview must advance independently, including preview versions ahead of stable.

## Decisions

- Git tags are the release version: `vMAJOR.MINOR.PATCH` is stable and
  `vMAJOR.MINOR.PATCH-preview` is preview. Each new preview advances the core version;
  there is no separate preview counter. Promote a tested preview commit by tagging the
  same core version without the suffix.
- `scripts/release.sh` creates annotated local tags on HEAD. Bumps start from the highest
  stable or preview tag reachable from HEAD; `stable promote` preserves a tested preview's
  version and commit, including an earlier preview. The helper never fetches or pushes.
- The manually dispatched `tag-release.yml` workflow selects a channel and a major, minor
  or patch bump, fetches full history and tags, and calls the same helper at the selected
  ref's dispatch commit. A read-only preparation job resolves the default branch to an
  immutable commit and runs its helper and dependencies against a separate checkout of
  the target; it never executes the selected ref's code. A separate privileged job checks
  the tag name, creates an annotated tag for the dispatch commit through the GitHub API,
  and dispatches `release.yml` on that tag. This job uses only a pinned action's inline
  code, with no checkout, package installation or runner state from preparation.
  `GITHUB_TOKEN` ref creation does not trigger another workflow itself.
  Tag creation requests queue to avoid competing manual bumps. Preview promotion remains
  available through the local helper.
- Ordinary CI runs checks on every pull request update; the `merge on pass` label records
  approval of functionality and design, authorizes merging once required checks pass and
  opts a PR into full Docker-backed E2E, including later pushes while the label remains.
  The `run e2e` label also requests the full suite on drafts and later pushes, without
  approving functionality or design or authorizing merging. Agents use targeted local E2E
  and request early full runs on GitHub only for sweeping changes that benefit from broad
  coverage or an explicit user request; otherwise the pre-merge suite provides that guard.
  After the requested E2E jobs finish and their results are reviewed, agents remove
  `run e2e` unless upcoming fixes or sweeping changes still warrant another full run.
  They reapply it when needed; removing it during a run would cancel that run.
  Fixes that change approved functionality or design require renewed approval. The always-running
  `validation` gate fails when a PR lacks `merge on pass`, or E2E is unrequested, skipped,
  cancelled or unsuccessful; it is the required branch check (see [CI setup](../ci.md)).
  PRs test GitHub's temporary merge
  commit and need not be up to date with `main` to merge; the full suite on each `main` push
  covers combinations of PRs (see [CI setup](../ci.md)). New PR runs cancel superseded
  PR runs. Main pushes, manual CI requests and merge groups request checks and full E2E
  without a label. PRs and merge groups always test their combined code rather than reusing
  main/tag CI. The tag-push or manually dispatched
  release workflow waits for successful CI at the exact tagged commit and verifies checks
  and both E2E projects succeeded. If no CI run appears within a minute, it requests CI
  on the release tag, including for an intermediate commit in a batch push. Main/tag CI runs
  for the same commit queue without cancellation and check for a previous pass before running
  tests, so competing push and release requests do not duplicate E2E. A release waits up
  to 30 minutes; without a previous pass, unsuccessful CI blocks release until rerun
  successfully.
  Android signing secrets are checked before either build starts. After CI passes, it
  builds a signed APK and builds and pushes a multi-platform container image to GHCR in
  parallel. The GitHub Release with the APK and checksum and the channel image aliases
  are published only after both builds succeed. If Android fails, an exact-version image
  may remain without a published release or updated channel aliases.
- Publishing is opt-in through the repository variable `RELEASES_ENABLED=true`. The release
  workflow accepts manual dispatch on a release tag for automated tagging and recovery,
  rejects branch refs before checkout or builds, and never deploys to a production server.
  Manual tag creation also requires releases to be enabled.
- Exact image tags remain fixed once their GitHub Release is published. `stable` and
  `latest` point to the highest published stable version; `preview` points to the highest
  published preview version. Publishing an older backport does not move a channel backwards.
- Release workflows queue rather than cancel one another. Android's version name is the
  tag without `v`; its version code is the release workflow run number. Preserve that
  workflow's identity and publish forward releases in sequence so version codes increase.
- The tag parser's channel output supplies build-only `CATCH_CHANNEL` to web builds and
  Android sync. A build without one, Docker included, is the `dev` channel, which is
  never tagged or published and uses the light-blue development icon treatment; this is
  build identification, not a new official release channel. Preview and dev browser/PWA icons
  use distinct `/preview/` and `/dev/` paths, and their Android flavors overlay
  launcher/background resources independently of debug/release build type.
  Both reuse the stable adaptive foreground and monochrome geometry. Distribution icons and
  the Settings > Update icon identify the channel; other application UI and theme colors
  remain stable (see [brand assets](../branding.md)).
- Stable Android uses `org.iloni.catchnotes`; preview uses `org.iloni.catchnotes.preview`
  and the name Catch Preview. They can coexist and keep separate device data. Both are
  signed with the operator's persistent release key, held in Actions secrets and backed up
  outside Git. Development builds use the `dev` flavor, `org.iloni.catchnotes.dev`, named
  Catch Dev: a debug-signed build under a released id cannot update that app, and the
  install tooling would uninstall it and its unsynced notes to make room. The flavor has
  no release build, and `./scripts/dev.sh android` installs it whatever the environment says.
  Its `--static` option bundles the frontend without hot reload and pins native API requests
  to the worktree's HTTP server (Tailscale, or adb with `--usb`). The build-only
  `CATCH_DEV_SERVER_URL` enables cleartext and mixed content for that dev APK. Stable and
  preview builds ignore it and keep their normal HTTPS server setup.
  Bundled dev sessions are keyed by that server URL: Android's local page origin is shared
  across worktrees, unlike live reload's separate Vite origins. An existing unscoped session
  is kept but not reused by a pinned dev build; sign in once for each worktree URL. Native
  SQLite databases and outboxes remain per user and are not cleared when switching builds.
- Preview deployments use their own database and Electric storage. Startup migrations make
  sharing production storage with preview, or treating image rollback as database rollback,
  unsafe.
- Settings > Update shows the server's build version and channel, plus Android's installed
  package version. Recent GitHub releases are filtered to the server channel. Android
  checks on launch, resume and periodically; an available update marks Settings and Update,
  and a dismissible prompt links to the page once per installed app/server/target version.
- Browser and PWA builds publish an uncached `build.json` with a unique build id embedded
  in the client. Launch, resume, focus, reconnection, periodic and manual checks compare
  the deployed id, including when another tab already activated an update. This also works
  in browsers without service workers. Development's Vite server and native apps do not
  use this check. Missing or malformed metadata on an older server is ignored.
  A dismissible prompt offers **Reload to update** and **Later**; Settings > Update keeps
  the reload action available after dismissal. When the compatibility gate says the client
  is too old, the prompt says **Update required to sync** and **Keep working offline**, even
  if build metadata is unavailable or the optional update was already dismissed. A server
  that is too old still asks for a server upgrade instead. Prompts wait until open editors
  and drafts close. Reload waits for pending writes to reach the outbox or server, installs
  and explicitly activates a waiting service worker, then waits for it to control the page
  before reloading.
  Other tabs retain control of when their page reloads. Notes, outboxes and staged shares
  are never cleared. Offline or failed preparation keeps the current page and offers retry.
- Android updates target the server's exact published version, only within the installed
  app's channel and only forwards. The native plugin downloads the APK and checksum from
  GitHub, checks SHA-256, package identity, release version, increasing version code and
  the installed signing certificate, then opens Android's installer. Android may first ask
  the user to allow Catch to install updates. Development apps are never updated this way.
  Changing channels requires installing the separate app; it does not replace device data.
- Release versions describe builds, not API compatibility. An explicit client protocol and
  server-supported range gate REST and shape sync (ADR 0013). Incompatible clients keep local
  notes and queued writes while sync waits for an app or server update; compatible release
  differences do not require an update. Breaking-change commit markers document changes,
  but runtime enforcement comes from the protocol constants. PWAs receive new code through
  their service worker with user-approved reloads, but offline or already open clients can
  still run older code. Static build metadata is an additive recovery contract with a
  fallback for older servers; it changes no data API, queued write format or synced shape,
  so the API protocol and collection schema versions remain unchanged.

## Consequences

- A public GHCR package requires a one-time visibility change after its first publication.
- Conventional Commits describe changes, but do not automatically choose or push version
  tags. Releasing remains an explicit action by a maintainer. Release notes are generated
  from those commits ([ADR 0017](0017-derived-changelog.md)).
- APK distribution and the Android updater use GitHub Releases. Android installation needs
  user confirmation; channel image aliases still require an explicit pull and recreate.
- See [the release guide](../releases.md) for signing setup and deployment instructions.
