# AI configuration and hybrid search

This feature adds optional semantic search to ordinary keyword search. Keyword search stays
on the device and remains the default. Semantic search needs the Catch server, including
when the embedding model runs locally. There is no chat model or chat generation yet.

## Set up embeddings

As an admin, open **Settings > Admin > AI configuration**. Choose a provider, enter its
server endpoint, optional API key and embedding model, then choose the model's input format.
Hosted OpenAI and Google presets require a key; local/custom endpoints may use one too.
Discovery lists the provider's models and permits manual entry. A listed model may be a
chat model: **Test embedding** makes actual document and query embedding requests and verifies
matching dimensions. Saving with Background embeddings enabled repeats this test.

Enable **Background embeddings** and save. Catch indexes every user's ordinary notes,
including archives, without a separate per-user setting. The status panel shows indexed,
queued, running and failed notes. **Retry failed tasks** resets failed jobs. **Rebuild index**
invalidates all current vectors and queues a fresh generation. A different endpoint, provider,
model, input format or dimension count also rebuilds automatically; key rotation alone does
not. Disabling pauses indexing and makes semantic search unavailable. Changes while disabled
are caught up when enabled again. The Search page's switch does not pause indexing.

Concurrent admin edits are refused instead of overwriting another session. Progress polling
does not replace unsaved settings. If a save or rebuild reports a configuration conflict,
reload the page, review the saved settings and reapply your changes.

## Provider networking and models

Endpoints are reached **from the Catch server**. For Docker deployments, `localhost` refers
to Catch's container. `host.docker.internal` is mapped to the host gateway on Linux as well
as being available on Docker Desktop. A provider bound only to host loopback may still be
unreachable through that gateway: configure its listener and firewall to permit the Catch
container, or use a reachable LAN address/Compose service hostname. Avoid exposing an
unauthenticated model server to the public internet.

Ollama uses native `/api/tags` and `/api/embed`; its endpoint should be the server root,
for example `http://host.docker.internal:11434`. Compatible services use `/models` and
`/embeddings` relative to their base, typically ending in `/v1`. LM Studio, vLLM,
OpenAI, Google Gemini's compatibility endpoint and custom services are presets, not bundled
models. Install/load a supported **text embedding** model in your provider and follow its
API documentation. Compatible services must return floating-point vectors with indexed
rows. There is no redirect following, native Gemini task-type adapter, custom dimension
selection or arbitrary provider parameter editor.

Input formats are explicit and apply consistently to documents and queries:

- Plain text: neither receives a prefix.
- Nomic: `search_document: ` / `search_query: `.
- E5: `passage: ` / `query: `.
- BGE: documents stay plain; queries receive its retrieval instruction.

Use the format required by the selected model. Discovery does not identify this for you.
The server normalizes nonzero finite vectors, checks dimensions, bounds responses to 16 MiB
and limits each HTTP request to 60 seconds. Provider bodies and credentials are never shown
in errors. See [Ollama's embed API](https://docs.ollama.com/api/embed) and
[Google's compatible embeddings API](https://ai.google.dev/gemini-api/docs/openai#embeddings).

## Text disclosure and vault boundary

Enabling background indexing sends ordinary note text for **all users** to the configured
provider. A local provider still receives that text; with a hosted provider it leaves your
server. Semantic queries are sent only when the user enables that mode and searches online.
Make users aware of the provider and its policies before enabling indexing. No owner ids,
tag names or file bytes are submitted as embedding inputs.

Vault notes are excluded at the database boundary: jobs reference only ordinary notes.
Vault search never calls the search/provider API. Entering vault search resets the semantic
switch, so queries typed there cannot be sent automatically when returning to ordinary search.

Saved keys are encrypted with a key derived from `BETTER_AUTH_SECRET` and are never returned
by the configuration API. Changing a provider or endpoint clears a retained key; enter one
explicitly if that destination needs it. Restoring a backup on a server with another secret,
or changing the secret, requires reentering credentials. Backups still contain ordinary
note text and vectors; key encryption does not encrypt the whole backup (ADR 0012).

## Search behavior and limits

Both server rankings apply account/share authorization, primary and secondary tag ancestry,
Any/All, untagged, effective primary tag color and the archived preference before retrieval.
A revoked share's old token cannot return a hit. The client intersects hits with its current
notes and timestamps, prepends confirmed optimistic keyword edits, appends other local keyword matches after
server ranks, and never reintroduces an
unconfirmed shared copy into a successful hybrid response. Offline/unavailable fallback
uses the existing local collection, including its existing shared-copy sync delay.

Notes are split into 2,000 Unicode-character chunks with 200-character overlap and embedded
in batches of up to eight. Notes above 120,000 characters fail indexing explicitly; their
keyword search continues to work. Model token limits can reject shorter chunks too; Catch
does not silently truncate them. Empty and trashed notes are excluded. Text edits invalidate
old chunks immediately; untrashing queues a new job. Disabling or changing configuration stops subsequent batches; a request already sent may
finish at the provider. Jobs retry five times with backoff and
then appear as failed. Interrupted leases expire, and restore clears leases from the old
process. Provider/profile changes must be saved or rebuilt explicitly when a provider
replaces a model under the same name without changing dimensions.

Retrieval currently uses exact cosine scans with up to 120 candidates per ranking and 60
fused server hits. Very large installations need performance evaluation before adopting
this mode. Similarity supplies a ranking, not a relevance guarantee: there is no minimum
similarity cutoff. Local pending keyword matches may increase the displayed count up to
the Search page's existing 60-note limit. Queries above 1,000 characters use local search. Busy/unavailable responses and network
failures keep keyword results visible and retry the same query with 10–60 second backoff
while semantic mode stays enabled and connected. Turning it off or entering the vault cancels
those retries.

## Validation coverage

Deterministic fake HTTP provider tests cover native/compatible adapters, input formats,
vector validation, cancellation and sanitized errors. Isolated real-Postgres tests cover
backfill, changed/stale content, leases/retries, generations, enable/disable, credentials,
account isolation, filters and share revocation. Real dump/restore tests include vector rows,
job leases, pre-AI dumps and malicious uploaded SQL that must fail under the restricted role.
Targeted browser tests cover semantic mode, unavailable/older-server/offline fallback,
pending edits and vault queries, plus admin form polling and revision conflicts.

This does not establish embedding quality, hosted-provider quota/billing behavior, real
local GPU throughput, large-installation latency, Android native keyboard behavior or native
APK connectivity. Live provider credentials and models are required to verify those paths.
