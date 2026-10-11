# 0022 — Note version history

Status: Accepted

## Context

An edit, accidental replacement or restore must not destroy recoverable note content.
History belongs to the note's owner, including for a note shared by a link. Catch must
capture edits offline, keep vault content sealed, and let someone review a version without
putting it into the working editor or autosave path. Original restoration needs an online
check for newer edits; cached versions can be recovered as new notes offline.

The initial library benchmark compared compressed snapshots, JSON deltas, CRDT histories
and an adaptive delta policy. JSON deltas gave useful size and reconstruction tradeoffs,
but unrestricted text diffing on unrelated long paragraphs was much slower than taking a
snapshot. The selected design uses `jsondiffpatch` 0.7.6, `@dmsnell/diff-match-patch` 1.1.0
and `fflate` 0.8.3. Libraries compute/apply deltas and compress bytes; Catch owns capture
policy, anchors, identities, persistence, retention, replay protection and restore.

## Decision

**History is separate from the live note.** `note_history` is a small owner-filtered synced
control row. It names the kind, epoch, current content token, latest capture and retained
count. Existing note and vault-note shape columns and local schema versions stay unchanged.
The new control collection starts at schema version 1. Timeline metadata and payloads are
read through authenticated, protocol-gated REST endpoints with `Cache-Control: no-store`.
Public shares and readers' `shared-notes` never expose history.

**Store adaptive forward JSON deltas, with at most 31 dependencies.** A checkpoint is an
independent snapshot or a delta with an explicit parent. Full snapshots are used on first
capture, after depth 31, for dense text replacement, for unsafe patch keys, or when a delta
is not smaller after compression. Proposed patches must reconstruct the exact canonical
JSON before they can be stored. Arrays retain their order and unfamiliar fields remain
part of the content. Compressed payloads include a declared uncompressed byte length;
decoding bounds allocation and expansion to 16 MiB. Compression is zlib level 6 with a raw
fallback. Format 1 is explicitly versioned and can be decoded by server or device.

Payload identity is scoped to owner, note and history epoch. Identical payloads share one
`history_payloads` row; timeline events refer to it. `history_versions` retains the parent,
representation, depth, sequence, reason, capture time and server receipt time. Fetching a
version returns its whole bounded dependency chain in one response. Ordinary payload and
reconstructed content identities are checked before review and restore.

**Capture durable drafts, then immutable checkpoints.** A content change keeps its preimage
and saves a compressed current draft in an account-scoped IndexedDB history store. Idle
editing freezes a checkpoint after 30 seconds; continuous editing freezes after five
minutes. Closing the editor, backgrounding and locking the vault also freeze. Reload
recovery converts already encoded drafts into immutable recovery jobs, without needing a
vault key. A history job never replays content through a live-note PATCH. Jobs use the
existing durable outbox via the control collection; no second HTTP retry scheduler is
introduced. Same-note content-save coalescing cannot remove these separate transactions.
The server also keeps the authoritative displaced preimage on origin changes and after a
five-minute checkpoint gap, including changes made by older clients.

An explicit editor close waits for its latest content write to reach the durable outbox
and freezes its checkpoint before navigating away. A flush also waits for an already-started
debounced save, so close, backgrounding and vault locking cannot finish history while that
save is still being stored. A history storage failure is disclosed separately and does not
prevent closing a working note that has been saved.

A frozen job stores an independent snapshot fallback alongside its candidate delta until
upload succeeds. If its parent expires, the device durably switches to that fallback and
retries the same capture. If the note disappears or its epoch changes, the local job is
kept for recovery as a copy. Jobs are re-enqueued after startup if staging completed but
outbox insertion did not. Ordinary data is compressed; vault drafts, fallbacks and cached
payloads are ciphertext. Sign-out deletes this user's history database.

**Replay identities outlive retained content.** Updated clients include a stable UUIDv7
operation ID and origin ID on live-note writes. Origin high-water marks and request digests
are retained for the note's lifetime. An already applied or older operation is acknowledged
without applying it again, including after a restore or history clear. Reusing the latest
operation ID for a different body is rejected. Legacy queued writes retain their existing
mutation formats and receive an envelope when replayed by the new client; no outbox is
cleared. Older running clients may omit the envelope and retain their existing semantics.

**Restore is an online compare-and-set, never an optimistic queued write.** The editor
flushes its pending content and freezes history, then waits for this note's queued writes.
The device reads a fresh authoritative note and content token. Confirmation names the
scope and provides the latest content for review; when it differs from the device's note,
confirmation remains disabled until the user reviews it. The restore transaction locks the
live note before the control row, checks epoch and expected token, saves the actual current
preimage, changes content only, saves the restored result and advances the token. Ordinary
search text, link tracking and shared-note copies update in the same transaction.

Placement, color, pin/archive state, tags, reminders, shares and attachment deletion state
are not rolled back. A note in Trash must be restored from Trash first. Vault restoration
opens the authoritative current payload on the unlocked device, merges only selected
content, reseals it and uses its expected token to guard all concurrent vault changes.

Restore operation receipts contain identity and outcome token, rather than more content.
Repeated requests do not create duplicate versions. The device saves the operation ID
before sending and checks its receipt after a dropped response or reload; it never blindly
resubmits a new restore. A receipt returns the authoritative current note and says whether
a later edit superseded the operation. The working editor is reseeded only from this
confirmed result; selecting or canceling a preview never reseeds it.

**Vault history uses separate derived keys.** HKDF-SHA256 derives per-note/per-epoch keys
for encryption and keyed identities from the vault key. AES-256-GCM uses a fresh nonce and
additional data binding owner, note, epoch, format, representation and payload identity.
HMAC-SHA256 content/payload identities allow within-note deduplication while revealing no
cross-note content equality. Compression and comparison workers receive plaintext only
while the vault is unlocked and never receive its key. Lock waits for draft/checkpoint
sealing and durable storage, stops workers and clears history session plaintext. Password
changes keep history readable because the raw vault key is unchanged. A server preimage
not associated with an optimized capture can be retained as an opaque original vault-note
ciphertext (`vault-note` representation), opened with the existing note context.

**Retention protects whole dependency chains.** Keep up to 128 selectable versions and
16 MiB of unique stored payload bytes per note. These are ceilings; a large note can have
fewer versions. Dependencies below the selectable range are retained while needed. Delta
chains exceeding the byte cap require a snapshot. Pruning and capture happen under the
same control lock, and unreferenced payloads are removed transactionally. Origin markers
and restore receipts are not removed by this pruning. This release uses count/byte caps,
not a promised number of days or an account-wide storage quota.

Clear history is a freshness-checked online operation that rotates the epoch, removes its
versions/payloads and leaves the current note intact. Durable replay markers remain. Old
queued captures are rejected rather than republishing cleared history; their local bytes
can still be recovered as copies. Permanent note/vault/account deletion cascades history
server-side. Established notes whose content is cleared are retained, so empty content
cannot accidentally delete their history.

The device caches history per account and fetches a selected version on demand. Cache
trimming evicts whole note caches above a conservative 256 MiB byte estimate, while pinning
unsynced/rejected jobs and their dependencies. Cached versions are a convenience, not a
second promise of server retention. Payloads are not synced to every device.

**History has its own reader and comparison.** The working editor stays mounted, hidden
and inert, and historical state never enters `editorNote` or autosave. History opens only
from the footer beside the edited timestamp. The reader uses the note's colored surface and
takes the note's own places: its header sits where the note's toolbar does, with Back to
note at the top left, and in a pane its card has the note's card's edges, so nothing moves
when it opens. The working editor stays mounted during entry and exit so its scroll position
and undo stack survive review. Full screen, the pull that closes a note leaves the reader.

The dock stays and becomes the reader's (`HistoryDockSlot`, filled by the reader through a
portal so its state stays in one place). Where the reader is at least 640 pixels wide the
versions are listed beside the one being read, with Clear history under them, and the dock
holds Save as new note and Restore original. Narrower, the dock names the version being
read and grows upward into the list, as it grows for a note's palette; the list has no
search, since a note keeps at most 128 versions named by their times. Clear history sits at
the top of that list and its confirmation takes the list's place. Clearing leaves the
reader, which has nothing left to show. The restore confirmation expands within the reader
so the content being reviewed remains visible.

Version preview uses a separate read-only BlockNote instance without live-note
hooks, mutation callbacks or editor controls. Unsupported content has a disclosed fallback
with the preserved document data. Long documents render in explicit 40-block increments;
restore and copy always use the entire reconstructed document.

Changes compare the selected version to a frozen current-on-device state from viewer
entry. A later live update produces a notice rather than changing that baseline. Comparison
runs in a separately cancelable worker and is read as one document, the way a word
processor shows tracked changes: the current note in its order, with the blocks it lost
left where they were. Words a block gained are tinted and underlined (`<ins>`), words it
lost are tinted and struck through (`<del>`), so the two differ by more than a color that a
note's own color could hide. Whole added and removed blocks carry the same marks along
their edge. Long runs of unchanged blocks fold away, keeping two on each side of a change.

Stable unique block IDs align blocks. A block typed or pasted again has a new ID, so the
blocks IDs leave over are paired in order by what they say: identical ones, then ones
sharing at least half of their words. A longest increasing subsequence distinguishes real
reordering from index shifts caused by additions, and nested blocks are compared the same
way inside their parent. Words are split with `Intl.Segmenter` and aligned by longest
common subsequence; a block whose content is not text (a table, a file) or is too long to
align is shown as removed and added. A change that leaves the words alone is named
(Formatting changed, Checked, Unchecked, Moved), so formatting, check state and unfamiliar
fields cannot disappear. A prop only one side names is not a change: imported notes leave
out what the editor writes in full. Storage deltas are never presented as a user-facing
diff.

Save as new note is a distinct action available for cached versions offline. It creates a
new unpinned, unarchived gallery note with fresh dates, no tags, reminder or share, in the
same ordinary/vault context. Still-available files are copied through the existing attachment
copy path with new placement IDs; deleted bytes are not retained or resurrected by content
history. The UI states that files may no longer be available.

## Compatibility and consequences

Client protocol 6 requires the new history routes/control shape. Server range 2–6 preserves
older live-note requests and existing synced columns. Upgrade the server/migrate first,
then clients. A protocol-6 client on a protocol-5 server pauses sync through the existing
compatibility gate while retaining local notes and queued writes. Backups include the new
ordinary tables automatically and require no superuser migration.

History adds recoverability, not collaborative editing or conflict-free merging. New offline
edits arriving from another origin still use Catch's existing live-write behavior; the server
preserves displaced content. Legacy clients have less compact checkpoint capture and lack
operation envelopes. Retention and original restore are server-authoritative.

Synthetic desktop benchmark results are evidence for choosing the codec, not Android or
end-to-end latency guarantees. Native-device timings, large-note UI behavior and actual
Postgres index/table overhead need measurement alongside release testing. Byte budgets and
anchor depth can change without changing format 1; encryption and decoding contracts cannot.
