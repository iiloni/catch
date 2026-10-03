# 0002: Hybrid search in Postgres

Status: accepted, partially implemented (2026-09-27)

## Decision

Search runs entirely inside Postgres so results are filtered by user inside the query:

- **Keyword**: `notes.search`, a generated `tsvector` over `search_text` with a GIN index
  (implemented).
- **Semantic**: pgvector embeddings in a separate `note_embeddings` table that stores the
  model name and dimensions per row, and is never synced to clients (not implemented yet).
- **Fusion**: reciprocal rank fusion of both rankings in one SQL query.

Embeddings come from an OpenAI-compatible endpoint or Ollama over HTTP, configured by the
instance admin. A Postgres-table job queue processed inside the API process computes them;
changing the model triggers a re-index. If keyword ranking proves weak, ParadeDB's
`pg_search` adds BM25 without another service.

Offline, keyword search runs on the client over the synced collection; semantic search
needs the server.

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
notes are included, trashed notes excluded, and result badges show the assigned tags.
Recent text searches remain available. See ADR 0015 for tag semantics.

## Why not a separate vector store

A separate store (e.g. LanceDB) has to be kept in sync with the primary database, and
per-user filtering happens after retrieval, which scans far more rows than needed.
