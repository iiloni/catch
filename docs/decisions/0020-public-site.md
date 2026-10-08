# 0020: The public site

Status: accepted (2026-10-05)

## Context

Catch's public face was its README. A marketing page, user and admin documentation and a
readable changelog need a home at `https://catchnotes.site`, and they should look like the
product they describe.

## Decisions

- **One site, in this repository.** `apps/site` holds the marketing page at `/`, the
  documentation under `/docs` and the changelog under `/changelog`. Documentation and the
  changelog change with the code, so they are reviewed and released with it.
- **Next.js with Fumadocs, exported as static files.** Fumadocs gives the documentation its
  layout, navigation and search, and its home layout gives the other pages the same header.
  `output: 'export'` writes plain files, so there is no server to run or secure, and search
  is an index the browser reads. Nextra was the alternative considered.
- **Nothing shared with the app at runtime.** The site is not installed or built in the
  production image (the Dockerfile's build installs the server and web app only), is not
  served by the Catch server, and is outside the app's content security policy and service
  worker. It is started on demand (`./scripts/dev.sh site`), not with the stack.
- **Tokens are shared, components are not.** The brand colors are read from
  `branding/catch-brand-tokens.json`, and the lockups from `apps/web/public/wordmark`. The
  neutrals, glass and note colors are copied from `apps/web/src/styles.css` into
  `apps/site/src/app/global.css` and kept in step by hand; Fumadocs is themed through the
  same shadcn variables (`fumadocs-ui/css/shadcn.css`), so the documentation and the
  marketing pages cannot drift apart. A shared component package would tie the app's
  release to the site's framework for a handful of buttons.
- **The site extends the app's look.** Same fonts, warm graphite canvas, amber brand, glass
  and note colors, with note-colored cards as the page's building blocks. It follows the
  system theme, as the app does. Motion is restrained and CSS only: content arrives once and
  the hero's screens land with the mark's gentle drop, all disabled under
  `prefers-reduced-motion`. One section is allowed to be showy, because the app's motion is a
  feature (ADR 0003), and it shows recordings of the real app rather than imitations.
- **Pictures of the app are captured, not drawn.** `./scripts/dev.sh screenshots` signs up a
  fresh account on the worktree's stack, writes a fixed set of notes with the app's own
  actions and captures each screen in light and dark. The pictures are committed, so
  building the site does not need a running app.
- **The page is written for people leaving Google Keep, and says what Catch is not.** The
  hero states that there is no hosted Catch. The comparison (`src/lib/comparison.ts`) lists
  the rows where Catch is behind, takes every claim about another product from that
  product's own pages, and carries the date it was checked. Claims about Catch must be true
  of the released product. The latest published preview is the capability baseline for the
  marketing page and user guides. Features are presented together without release-channel
  badges or a separate "new" section; channel choices belong in installation and update
  guidance, and version history in the changelog.
- **The changelog is the release tooling's JSON** (ADR 0017), generated when the site is
  built and validated against the schema version the site knows. It needs full Git history
  with tags, which a shallow CI clone and the development container lack: there the page
  links to the releases instead. A deploy sets `SITE_CHANGELOG=required`, so it fails rather
  than publish an empty changelog.
- **Deployed from GitHub Actions to Cloudflare Workers with static assets**, not by
  Cloudflare's Git integration, whose clone has no tags. `.github/workflows/site.yml` builds
  on pushes to `main` that touch the site or its inputs and uploads the export; it is skipped
  until the repository has the Cloudflare credentials and enables `CLOUDFLARE_SITE_ENABLED`.
  `apps/site/wrangler.jsonc`
  names the `catch-site` Worker and serves the export directly, without a Worker script,
  preserving trailing-slash URLs and the exported 404 page. The user attaches the custom
  domain in Cloudflare; the workflow does not manage DNS. Workers replaces the original
  Pages target while keeping the same static build.
- **The Compose file runs the published image.** The page's quick start is "download two
  files, fill in four settings, start it", which the old default of building from source did
  not allow. `docker-compose.yml` now names `ghcr.io/iiloni/catch:stable` (overridden by
  `CATCH_IMAGE`), and `docker-compose.build.yml` builds a checkout instead.

## Consequences

- `pnpm check` and CI build the site, which adds its dependencies to an install and about
  half a minute to a check.
- A change to the app's tokens in `styles.css` has to be repeated in the site's
  `global.css`.
- The comparison goes out of date as other products change; its date says how old it is.
- A deployment that builds from a checkout must add `COMPOSE_FILE` to its `.env` to keep
  doing so. `scripts/update.sh` stops with that instruction rather than start a published
  image over a database a newer build has migrated.
