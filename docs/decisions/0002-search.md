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

## Why not a separate vector store

A separate store (e.g. LanceDB) has to be kept in sync with the primary database, and
per-user filtering happens after retrieval, which scans far more rows than needed.
