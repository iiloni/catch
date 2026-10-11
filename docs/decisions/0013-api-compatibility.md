# 0013: Client/server API compatibility

Status: accepted (2026-10-01)

## Context

Android clients update separately from their self-hosted server. Open or offline PWAs also
keep older code after a server upgrade. Release versions identify builds, but do not tell us
whether two builds can safely exchange data. An incompatible response can corrupt the local
view; an ordinary 4xx write rejection discards that write from the outbox.

## Decisions

**One protocol for REST and synced shapes.** `packages/shared/src/protocol.ts` defines the
client's `API_PROTOCOL_VERSION` and the server's inclusive `SUPPORTED_API_PROTOCOLS` range.
Protocol 1 starts this contract; stable, preview and development use the same protocol rules.
Release versions, Git commits and database migration numbers do not determine compatibility.

**Check both directions.** Clients first read public, uncached `GET /api/compatibility`,
which returns `{ min, max }`, and declare their protocol in `X-Catch-Protocol` on data
requests. Server middleware rejects absent, malformed and unsupported declarations with
HTTP 426 and the shared `INCOMPATIBLE_PROTOCOL` error including its supported range, before
the request reaches writes or Electric. The header is allowed by Android CORS preflights.
Clients refuse data requests to pre-protocol servers whose bootstrap endpoint returns 404.
There is no legacy header fallback: the only existing user will manually update the client
for this release. Sync or export existing changes before upgrading a pre-protocol client;
that old client's 4xx handling cannot preserve writes when a new server rejects them.

**Keep recovery reachable.** Health, compatibility, authentication and update metadata stay
outside the gate. GET/HEAD attachment content, public preview assets and ticketed backup
downloads also remain readable: HTML media and system browsers cannot set the header, and
these endpoints serve bytes rather than a versioned data model. Their existing auth/ticket
guards still apply. Mutating the same paths is never exempt. These recovery and byte
contracts must remain backward compatible independently of the supported data protocol.

**Pause without deleting.** Client transport rejects incompatible REST requests with a
distinct retryable error. The outbox treats incompatibility as a paused connection while
keeping its real network state separate. Electric's fetch wrapper waits, honoring stream
abort signals, rather than terminating on a 426. Persisted notes remain readable and editable;
new writes stay queued in the leader tab. Other tabs retain the existing limitation that
only the outbox's leader can save while sync is unavailable (ADR 0007).
The header indicator and Settings > Update explain which side needs updating; editor saves
say they are stored on the device. Loading pages stop waiting for a server snapshot while
incompatible. Updates are required for sync only when the protocol is outside the range.

**Recover automatically.** Checks run on launch, resume, focus, reconnection, every five
minutes and through Check for updates. Data requests recheck an expired bootstrap result
(one minute); a request's 426 catches an upgrade racing a cached result. A successful check
unblocks Electric and wakes the outbox. Network errors or malformed metadata never count as
permanent write-validation failures. The client never clears local data to resolve a mismatch.

## Changing the contract

No protocol edit is needed for ordinary pushes, UI changes, compatible fixes, server-only
schema changes, or additions that both sides can safely ignore or handle through fallbacks.
Review both **old client → new server** and **new client → old server**, including offline
queued writes and shapes; TypeScript checking one checkout cannot verify mixed versions.

Examples requiring a new protocol unless a compatibility path is supplied:

- Removing or renaming a request/response/shape field, changing its type or meaning, narrowing
  accepted values, or making an optional request field required.
- A new client requiring a new endpoint, response field, shape or enum value an older server
  cannot supply. An additive server change can still break this direction.
- Changing note content encoding, ordering, write replay/idempotency or txid semantics.
- Changing a synced shape so older clients cannot interpret its rows safely.

For such a change, increment `API_PROTOCOL_VERSION`. Set the server's maximum to that version.
Raise the minimum to the new version if old clients are no longer supported; retain a lower
minimum only when the server actually implements and tests those older contracts. A range is
a promise of support for every protocol in it, not an arbitrary grace period. For example,
adding a required client capability can produce client protocol 2 with server range 1–2;
removing protocol-1 fields without an adapter requires range 2–2. An old server's range 1–1
then correctly blocks the protocol-2 client. Increment once for an intended incompatible
contract, not automatically for every commit contributing to that unpublished contract.

Use `feat!`/`fix!` or a `BREAKING CHANGE:` footer for incompatible changes and describe the
upgrade order and supported range in release notes. Release SemVer follows `docs/releases.md`
and is independent of the protocol counter.

When shape columns change, also bump the affected collection's local `schemaVersion`
(ADR 0007). That invalidates cached synced rows; it does not migrate queued writes. If changed
client code cannot interpret existing outbox payloads or local note content, add a lossless
device migration/adapter before replay, or preserve the old write format. Protocol gating
alone is not a device-data migration. Never discard an outbox to make an upgrade succeed.

Add tests for old/new requests at the supported boundaries, refusal before mutations or
shape forwarding, local editing and queued-write survival during a mismatch, and recovery.
Document the compatibility decision in the change even when no counter bump is needed.

## Consequences

- Compatibility maintenance is tied to contract changes, not pushes or release bumps.
- Protocol 3 adds reminders (ADR 0018) with range 2–3: protocol 2 clients are unaffected, and
  a protocol 3 client needs a server that has them.
- Protocol 4 adds shared notes (ADR 0021) with range 2–4, on the same terms.
- Protocol 5 adds explicit gallery preview choices (ADR 0006) with range 2–5. Old writes
  omit the new field without clearing it; the new client requires the added shape columns
  and write support, so the server is updated first.
- Supporting many past protocols needs adapters and tests. The tag feature uses protocol 2 with range 2–2 (ADR 0016); narrowing a range
  deliberately requires affected clients to update.
- Gating cannot cancel requests already accepted by a running older server. Server upgrades
  should still preserve replay safety and use the normal migration/backup process.
- Authentication/bootstrap and download bytes remain stable recovery contracts; changes to
  them need their own backward-compatible rollout instead of relying on this gate.

Protocol 6 adds note version history (ADR 0022), including its required control shape and
conditional restore routes. The server supports 2–6: existing note/vault-note shapes and
legacy request bodies remain valid. Updated clients add stable replay envelopes to existing
queued mutations without clearing or rewriting their content. New clients must upgrade
the server and apply its migration first; against protocol 5 they keep local editing and
pause sync until the server is upgraded.
