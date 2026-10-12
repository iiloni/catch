# 0002: Hybrid search in Postgres

Status: accepted (2026-10-11)

## Decision

Local keyword search is the permanent default, online and offline. The Search page's
optional **AI search** switch in the filter panel starts off and combines local keyword matches with
server hybrid ranking. It requires connectivity to Catch's server even with a local
embedding provider. Switching it off changes this view, not background indexing.

Settings > Admin > AI configuration enables indexing for every user's ordinary notes,
including archived notes, without per-user consent. The page discloses that note text and
semantic queries go to the selected provider. Vault content is never indexed; vault search
stays on the device and never calls the search API. Entering the vault turns semantic mode
off, including on exit, so vault queries cannot be sent automatically afterwards.

The server uses Postgres for hybrid ranking:

- **Keyword**: the generated `notes.search` tsvector and English rank, together with literal
  all-word substring matching (including punctuation). Ordinary local keywords retain
  their existing all-word matching and title-first ordering.
- **Semantic**: normalized pgvector embeddings in server-only `note_embeddings`, one row
  per overlapping note chunk. Exact cosine retrieval currently scans eligible embeddings;
  there is no approximate index or separate vector service.
- **Fusion**: reciprocal rank fusion with constant 60, up to 120 candidates from each list,
  returning at most 60 hits. Each ranking applies user authorization and the same tag,
  color and archive filters before limiting. Reader copies require a current share token;
  revocation excludes them in the next server query without waiting for device sync.

The client renders its local notes from server ids and checks their edit timestamps. Stale
semantic hits are discarded, and pending local keyword matches are included ahead of server
hits. Shared keyword copies are included in a successful hybrid response only when the
server confirms them. On a disabled, missing, unavailable or incompatible server, local
keyword search remains available. Offline shared copies retain the existing sync semantics.

Native Ollama and OpenAI-compatible HTTP endpoints supply embeddings. Admin configuration
stores provider, endpoint, model and an automatically selected input profile under an embedding field; chat configuration
and generation are outside this decision. Discovery uses provider capability/type metadata
when available, otherwise model-name hints, to exclude known chat and non-text models. Unknown
aliases remain testable. A bounded Ollama `/api/show` inspection never loads or generates a model.
Discovery does not verify embeddings: tests
and enabling saves embed both a document and a query and check their dimensions.

A durable per-note Postgres queue is processed inside the API. A note trigger invalidates
stale chunks and coalesces text/trash changes; periodic reconciliation handles backfill and
enablement races. Jobs have leases and bounded retries. The worker claims a bounded group of ordinary-note jobs
and sends up to 50 chunk inputs or 64 KiB of formatted UTF-8 text per request. Long notes keep
atomic per-note publication. Rejected input batches split; HTTP 413 lowers the active request
ceiling. Outages, auth and rate limits back off without per-input fan-out. Each publication
checks its own user, content and lease, so one stale note does not invalidate healthy peers. Publication rechecks the configuration,
content and lease after the HTTP call, so edits, disabling, rebuilding and model changes cannot
install obsolete results. Endpoint/model/profile/dimension changes start a new generation;
API-key rotation alone preserves it. An optional profile version keeps older E5 vectors on
their original format until saving the automatic instruction format starts a new generation.
Clients that lack the version field can ignore it; it does not change ordinary data contracts.
Configuration writes and rebuilds use optimistic revisions and recheck the actor's live admin
role transactionally. Disabling pauses indexing and search;
re-enabling catches up changes. Embeddings and jobs never sync to devices or include vault rows.

The addition preserves existing REST/write/shape contracts and collection versions (ADR 0013).
The optional discovery `kinds` field has a model-name fallback and preserves the `models` array.
Old clients ignore these routes, settings and additional response fields; new clients handle missing search routes with
local keyword fallback. No protocol or local collection schema-version bump is needed.

See [AI configuration](../ai.md) for networking, formats, limits and validation coverage;
ADR 0012 covers vector provisioning, credential backups and restore leases.

## Current search page

The page currently uses the client keyword path over synced notes, including while online.
It combines text with tag and color filters without a network request. Roots are browse
shortcuts; the searchable tree selects any depth. A parent includes descendants assigned
as either primary or secondary tags. Multiple selections support Any/All matching and
intersect with text and effective primary-derived color for unlinked swatches. A linked
color swatch selects its root tag, including secondary assignments and descendants of any
color. The glass filter panel has sliding Colors/Tags tabs and remembers the last tab on
the device. The dock filter button toggles the panel; outside taps, Escape and back also
close it. Switching between browsing, results and no matches fades and settles the content
with the shared spring, while subsequent result changes retain their list animation. Active
filters stay mounted above these views; only changed badges enter or exit, and the remaining
badges spring into position after removal. Each removal button shares its badge’s glass
surface. Any/All matching sits beside Find tags when multiple tags are selected. Focusing
the search field expands it to full width and hides matching controls; leaving focus restores
them without changing the selection or match mode. The tab views share a bottom anchor
while sliding and resizing, and horizontal overflow is clipped.
Reduced motion switches views immediately. Untagged is separate from No color. Archived
notes are included unless the panel's "Show archived notes" switch is off; the switch sits
below the segmented Colors/Tags control, after a horizontal divider, is remembered on the device, and is a view preference rather than a filter:
it does not count toward the dock's filter badge and Clear filters leaves it alone. Tag
counts follow it. Trashed notes are excluded, and result badges show the assigned tags.
AI search sits below the archive switch and also remains independent of Clear filters.
Recent searches retain their selected AI/text mode and show a sparkle on AI entries; selecting
an entry restores that mode. Ordinary history is stored per account and removed on sign-out.
Vault history is confined to memory until exit/lock. Legacy strings become text-only on a
single-account device; unowned multi-account history is left untouched. See ADR 0016 for tag semantics.

## Why not a separate vector store

A separate store (e.g. LanceDB) has to be kept in sync with the primary database, and
per-user filtering happens after retrieval, which scans far more rows than needed.
