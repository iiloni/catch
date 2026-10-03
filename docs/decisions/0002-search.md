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
intersect with text and effective primary-derived color. Untagged is separate from No
color. Archived notes are included, trashed notes excluded, and result badges show the
assigned tags. Recent text searches remain available. See ADR 0016 for tag semantics.

## Why not a separate vector store

A separate store (e.g. LanceDB) has to be kept in sync with the primary database, and
per-user filtering happens after retrieval, which scans far more rows than needed.
