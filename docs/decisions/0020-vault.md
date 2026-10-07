# 0020: The vault

Status: accepted (2026-10-06)

## Context

Catch's server reads every note. It derives search text, fetches each link for a preview,
writes note text into reminder notifications and makes attachment thumbnails; backups are
unencrypted and hold everyone's notes (ADR 0012). That suits most notes and not the few a
user would not want an admin, a leaked backup or a compromised server to read.

## Decisions

**The vault is end to end encrypted.** A vault note is sealed on the device and the server
stores, syncs and backs up only ciphertext. An app lock in front of ordinary notes was
rejected: it would hide notes from someone holding the phone and from nobody else.

**One vault key, sealed twice.** A vault has one random 256 bit key, which seals each note
with AES-256-GCM under a fresh random nonce. The `vaults` row keeps that key sealed under a
key stretched from the vault password (PBKDF2-SHA256, 600,000 rounds, a per-vault salt; the
round count is stored so it can rise) and again under a key derived from a recovery code
(HKDF-SHA256 of 160 random bits). Changing the password seals the same key again, so notes
are not re-encrypted and the recovery code stays valid. Everything uses Web Crypto, which
the web app and the Android WebView both have; PBKDF2 was chosen over Argon2 to avoid
shipping a WASM KDF. The vault password is separate from the account password: an admin
can reset the latter (ADR 0011), and that must not open the vault.

**Ciphertext is bound to its place.** Each sealed value carries its owner and role as
additional data (`catch-vault-note:<user>:<note>`, `catch-vault-key:<kind>:<user>`), so the
server cannot serve one note's ciphertext as another's or one user's key as another's.

**The password is optional per device, not per vault.** Unlocking can ask the device to
remember the vault. It then stores the non-extractable `CryptoKey` in an IndexedDB database
named after the user (`catch-vault-<user>`), and the vault opens there without the password.
"Lock now" forgets it, as does signing out. A device that does not remember locks on reload
and after five minutes in the background. A vault with no password at all was rejected: the
key would have to live on the server, which is the party the vault excludes.

**Forgetting both secrets loses the notes.** The recovery code is shown once at setup and
kept nowhere. Without the password or the code nobody can open the vault; the only way on
is to delete it. This is the cost of the server holding no key.

**Vault notes sync like any collection, as ciphertext.** `vaults` and `vault_notes` are
user-filtered shapes with persisted collections, and note writes go through `write()` and
the outbox (ADR 0007), so the vault works offline once a device has synced it. The device's
SQLite database and the outbox therefore hold ciphertext too. `lib/vault.ts` holds the key
and the opened notes in memory only, and hands the rest of the app ordinary `Note` objects.
Creating a vault and changing how its key is sealed are plain requests that need a
connection. Creating one where one exists is a 409: two devices setting up at once would
otherwise seal notes under different keys.

**A note is sealed whole.** `data` holds the content, color, pin and position together, so
the server learns only the note's id, size and times. The price is that last write wins for
the whole note, not per field as for other notes (ADR 0007).

**What the vault leaves out.** Anything that needs the server to read a note:

- Link previews. Fetching one tells the server the link, so vault notes show none.
- Reminders. The notification text is written on the server.
- Attachments. Files would need sealing on the device and lose server thumbnails, video
  posters and range requests; deferred.
- Tags, the Deck, archive and trash. Deleting a vault note is final, with an undo toast.
- Search. Vault notes are not searched yet; search runs on the device (ADR 0002), so it
  can cover an unlocked vault later without the server.
- Moving an existing note into the vault. Its plaintext would remain in server backups and
  the Postgres write-ahead log, which a move could not honestly undo.

The dock's compose button on the Vault page creates a vault note directly: the quick-note
window would save the same words as an ordinary note.

## Consequences

- The server sees how many vault notes a user has, their sizes and when each changed.
- A script running in the app's origin while the vault is unlocked can read its notes, as
  it could read any note. The content security policy (ADR 0015) is what guards against
  that; the vault does not add to it.
- A remembered key is as safe as the device and its browser profile.
- Web Crypto exists only in secure contexts, so a server reached over plain HTTP (other
  than localhost) cannot use the vault; the forms say so.
- Additive for compatibility (ADR 0013): new routes, shapes and tables, and no change to
  an existing one, so the protocol version stays. The vault's collections sync only while
  the Vault page is open, so against an older server, which has no such shapes, that page
  keeps looking for a vault and the rest of the app is unaffected.
- Backups need no change (ADR 0012): the new tables are dumped and restored like any other.
