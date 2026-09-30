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
- Ordinary CI runs checks and E2E on main pushes and pull requests. The tag-triggered
  release workflow reuses those checks, builds a signed APK, publishes a multi-platform
  container image to GHCR, and publishes a GitHub Release with the APK and checksum.
- Publishing is opt-in through the repository variable `RELEASES_ENABLED=true`. The release
  workflow has no manual dispatch trigger and never deploys to a production server.
- Exact image tags remain fixed once their GitHub Release is published. `stable` and
  `latest` point to the highest published stable version; `preview` points to the highest
  published preview version. Publishing an older backport does not move a channel backwards.
- Release workflows queue rather than cancel one another. Android's version name is the
  tag without `v`; its version code is the release workflow run number. Preserve that
  workflow's identity and publish forward releases in sequence so version codes increase.
- The tag parser's channel output supplies build-only `CATCH_CHANNEL` to web builds and
  Android sync; Docker defaults to stable. Preview browser/PWA icons use distinct
  `/preview/` paths, and Android's preview flavor overlays launcher/background resources.
  Both reuse the stable adaptive foreground and monochrome geometry. Only distribution
  icons change: application UI and theme colors remain stable (see [brand assets](../branding.md)).
- Stable Android uses `org.iloni.catchnotes`; preview uses `org.iloni.catchnotes.preview`
  and the name Catch Preview. They can coexist and keep separate device data. Both are
  signed with the operator's persistent release key, held in Actions secrets and backed up
  outside Git. Debug development defaults to the stable flavor.
- Preview deployments use their own database and Electric storage. Startup migrations make
  sharing production storage with preview, or treating image rollback as database rollback,
  unsafe.

## Consequences

- A public GHCR package requires a one-time visibility change after its first publication.
- Conventional Commits describe changes, but do not automatically choose or push version
  tags. Releasing remains an explicit action by a maintainer.
- APK distribution uses GitHub Releases. Selecting a channel does not provide an automatic
  Android updater, and channel image aliases require an explicit pull and recreate.
- See [the release guide](../releases.md) for signing setup and deployment instructions.
