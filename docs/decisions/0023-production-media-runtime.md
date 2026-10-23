# 0023: Production dependencies and media decoders

Status: accepted (2026-10-22)

## Context

Container scans found development tools in the production dependency tree through Better
Auth's optional integrations, plus vulnerable Go code compiled into their esbuild binaries.
The base Node image also included npm and its own dependencies. Neither is used by Catch's
production entrypoint or backup CLI.

Sharp 0.34.5 bundled vulnerable native image libraries. Bookworm's FFmpeg 5.1.9 also has
unfixed decoder vulnerabilities, including CVE-2026-70632 in CineForm HD. Catch permits AVI
uploads, so restricting FFmpeg to local files does not prevent that decoder from running.

## Decision

Use Sharp 0.35.5 or newer for image decoding. Build FFmpeg 9.0.2 from the upstream release
archive, pinning its SHA-256 in the Dockerfile. Both development and production use that
binary, built for their target architecture. It keeps software video decoding, including
AV1 through dav1d, and WebP poster output. Only the local container demuxers Catch accepts,
the file protocol and the image2 output muxer are enabled; network protocols, devices and
hardware acceleration are disabled. This preserves the attachment contract in ADR 0010.

The production dependency graph excludes Better Auth's unused Next.js, Vitest and Drizzle
Kit integrations through the `better-auth>next`, `better-auth>vitest` and
`better-auth>drizzle-kit` removal overrides in `pnpm-workspace.yaml`. Its Drizzle adapter
and React client remain available. The Dockerfile assembles the runtime dependencies with
`pnpm --filter @catch/server deploy --prod --legacy /out`, using pnpm 12.15.0 pinned in
`package.json`. Omit package managers from the final image. The server, migration
entrypoint and backup CLI continue to run with Node directly; PostgreSQL 17 client tools
remain installed for backups (ADR 0012).

Refresh installed OS packages from the distribution's security repositories when building
the runtime layer. A cached layer does not pick up new security fixes: security rebuilds
must refresh that layer as well as the base image. Scan the resulting production image,
including findings without a fixed version, rather than only auditing the workspace.

## Consequences

- FFmpeg updates require changing both the version and checksum and testing video posters.
  Verify the archive against FFmpeg's release signature before recording a new checksum.
- Building FFmpeg adds build time. Release images build on native AMD64 and ARM64
  runners, with separate caches, before their digests are combined into the exact version;
  emulated ARM64 compilation exceeded the release job timeout. The source stage is cached
  independently of application changes; compiler tools stay there.
- Production installs must retain Sharp's architecture-specific optional binary packages.
- Dependency security updates do not change the REST/shape contracts, stored note content,
  outbox format or protocol version (ADR 0013).
- Source builds and dependency updates do not guarantee a CVE-free image. Triage remaining
  distribution/native findings by affected operation and update availability. Electric and
  Postgres images also need upstream security rebuilds; an unchanged tag alone cannot
  establish what a deployed container contains.
