# 0020: The vault

Status: accepted (2026-10-06), revised 2026-10-07 and 2026-11-10

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
and file with AES-256-GCM under a fresh random nonce. The `vaults` row keeps that key sealed
under a key stretched from the vault password (PBKDF2-SHA256, 600,000 rounds, a per-vault
salt; the round count is stored so it can rise) and again under a key derived from a recovery
code (HKDF-SHA256 of 160 random bits). Changing the password seals the same key again, so
notes are not re-encrypted and the recovery code stays valid. PBKDF2 was chosen over Argon2
to avoid shipping a WASM KDF. The vault password is separate from the account password: the
server sees the account password at every sign-in and an admin can reset it (ADR 0011), and
neither may open the vault.

**Notes are sealed synchronously.** Keys and files go through Web Crypto, which is
asynchronous. A note is sealed with the same cipher from `@noble/ciphers`, which is not, so
a change to a vault note is sealed inside the same `write()` that changes any other note and
the note actions need no second, asynchronous path. The price is that the raw key sits in
script memory while the vault is unlocked, where Web Crypto could have kept it out of reach;
a script in the page could read the opened notes either way.

**Ciphertext is bound to its place.** Each sealed value carries its owner and role as
additional data (`catch-vault-note:<user>:<note>`, `catch-vault-key:<kind>:<user>`,
`catch-vault-file:<user>:<seal id>:<part>:<piece>:<last>`), so the server cannot serve one
note's ciphertext as another's, one user's key as another's, or a file's pieces reordered,
cut short or swapped with its thumbnail's.

**The password is optional per device, not per vault.** Unlocking can ask the device to
remember the vault. It then keeps the key sealed under a non-extractable `CryptoKey` of the
device's own, both in an IndexedDB database named after the user (`catch-vault-<user>`), and
the vault opens there without the password. Locking forgets it, as does signing out. A
device that does not remember locks on reload, on leaving the vault and after five minutes in
the background. A vault with no password at all was rejected: the key would have to live on
the server, which is the party the vault excludes.

**A device can open the vault with a PIN instead.** A PIN of four to eight digits seals the
key a second time (PBKDF2-SHA256, 100,000 rounds, its own salt) inside the device's own key,
as an entry of its own in the same database. An older client reads only the remembered
entry, so it ignores the PIN and asks for the password; in that entry it would have taken the
PIN's copy for the key. The PIN is for convenience and for keeping
out someone who comes across an unlocked phone or computer, not a targeted attacker: a PIN
this short falls to a guess at every PIN by anyone who can copy the browser's files, however
it is stretched, so it guards the vault no better than remembering does against them. Five
wrong PINs in a row forget it and the vault asks for its password; the count is written
before each try, tries run one at a time, and a PIN with no tries left is never tried even if
the device failed to delete it, but someone with the browser's developer tools can reset it. A PIN and
remembering exclude each other, since a remembered vault never asks. Locking keeps the PIN;
switching it off, forgetting it and signing out remove it, as does the vault being deleted or
replaced. Because the vault opens again quickly, a device with a PIN or a fingerprint (below)
locks it sooner: a minute after the app is hidden, and after five minutes on screen with no
input, which covers a computer left open. A PIN known to the server was rejected: limiting its
tries there would need the server's help to open the vault and a connection to do it.

**The Android app can open the vault with a fingerprint.** Its threat model is the PIN's:
convenience, and keeping out someone who comes across an unlocked phone, not a targeted
attacker. `VaultKeyPlugin` seals the key a third time under an AES-256-GCM key in the
Android Keystore, one per account (`catch-vault-bio-<user>`), held in StrongBox where the
phone has one and bound to its account as additional data. The app keeps the sealed copy in
an entry of its own in the device's database, beside the PIN's; the Keystore key never leaves
the phone. The key opens only through a `BiometricPrompt` with a `CryptoObject` and a strong
(class 3) biometric: every use needs its own fingerprint (`setUserAuthenticationParameters(0,
AUTH_BIOMETRIC_STRONG)`, or a validity of -1 before Android 11), and the phone's screen-lock
PIN is never taken in its place. It is invalidated when a fingerprint is enrolled, so someone
who knows the phone's PIN cannot add their own finger and open the vault. A yes or no from
the prompt with the key kept elsewhere was rejected: anything that could skip the prompt
would have the key, while the Keystore gives nothing without a fingerprint. Many phones' face
unlock is weaker than class 3 and does not count, so the app says "fingerprint" unless the
phone also has face or iris hardware, where it says "biometrics".

A fingerprint and a PIN are independent ways in and can both be set. Entering asks for a
fingerprint first; its prompt's button, a dismissal or the phone's own lockout after too many
tries leads to the PIN, then the password. A change in the phone's fingerprints turns
fingerprint unlock off with a note saying why, and the next unlock with the PIN or password
offers once to turn it on again. Locking keeps it. Switching it off, switching off Lock
automatically (a vault that stays open needs no way back in), signing out and the vault being
deleted or replaced remove it, deleting the Keystore key and the sealed copy. Turning it
off fails loudly when either cannot be deleted. The others go on regardless, as with the PIN:
a copy for a deleted or replaced vault opens nothing, and signing out deletes the key and the
copy separately, so only when both deletions fail is a pair left behind. Keystore protection
for the PIN's copy, and unlocking with a passkey on the web, were left out.

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
otherwise seal notes under different keys. Changing the password of a vault since deleted
and set up again is a 409 too, told apart by its recovery copy, which names the vault.

**A note is sealed whole.** `data` holds the content, color, status, pin, position, whether
it is archived or in the trash, its tags and the names and types of its files, so the server
learns only the note's id, size and times. Tags are the user's ordinary ones; which notes
carry them is what is sealed. The price is that last write wins for the whole note, not per
field as for other notes (ADR 0007).

**The pages pivot; the vault is not a page.** A lock button in the header enters and leaves
the vault (`vaultMode`). Inside, the Gallery, the Deck, search, the archive, the trash and
Reminders show the vault's notes in place of the others, and a new note is a vault note. The
two are never shown together, which keeps "is this private" a property of where the user is
and not of each card. `lib/noteStore.ts` sends each change to the notes collection or to the
vault by the note's id, so the note actions, the editor and the dock are the same code for
both. Search runs on the device (ADR 0002) and so covers the open notes without the server.

Settings > Vault can hide the header's entry button on this device, with it shown by
default, even before a vault exists. This is a device appearance preference, shared by its
accounts like the theme. Settings and reminders still open the vault; while inside, the
leave button is always shown so there is a way back to ordinary notes.

**Reminders ring without saying what for.** A vault note's reminder is an ordinary row in
`reminders`, so the server's scheduler and the phone's alarms work unchanged, and the
notification reads "Vault note". The server therefore knows when a vault note is due.
`reminders.note_id` lost its foreign key to `notes` for this; the routes that delete a note
of either kind delete its reminder. Opening such a notification enters the vault first,
asking for the password if it is locked. The server cannot see that a vault note is in the
trash and would ring for it, so trashing one takes its reminder off and keeps it sealed in
the note, and restoring the note puts it back.

**Files are sealed on the device and stored as ordinary attachments.** A vault note's file
is a row in `attachments` named "Vault file" of type `application/octet-stream`, whose bytes
are the file sealed in 4 MB pieces; its real name, type and size live in the note. Reusing
the table keeps uploads, the outbox, quotas, copies (`sourceId`), account deletion and
backups as they are, and `attachments.note_id` lost its foreign key like the reminder's.
The server cannot make a thumbnail or a video poster, so the device makes one when the file
is added and uploads it sealed as a second row. A file is opened in memory to be shown:
there are no range requests, so a video downloads whole before it plays. Sealing is not the
cost: Web Crypto measured about 1 GB/s on a 2019 laptop, and phones have hardware AES too.

**What the vault leaves out.**

- Link previews. Fetching one tells the server the link, so vault notes show none.
- Moving an existing note into the vault. Its plaintext would remain in server backups and
  the Postgres write-ahead log, which a move could not honestly undo.
- Importing into the vault, and sharing into it from another app.

## Consequences

- A device still holding writes for a vault that was deleted and set up again elsewhere
  sends them into the new vault, where they cannot be opened. They are counted as
  unreadable and go when the vault is deleted. Likewise a file whose note was saved over by
  an older copy on another device stays on the server, unseen, until the note is deleted.
- The server sees how many vault notes a user has, their sizes and when each changed, which
  notes have files and how large, and when a note's reminder is due.
- A script running in the app's origin while the vault is unlocked can read its notes, as
  it could read any note. The content security policy (ADR 0015) is what guards against
  that; the vault does not add to it.
- A remembered key is as safe as the device and its browser profile. A fingerprint's copy is
  safer than a PIN's against someone who copies the app's files, since its key stays in the
  Keystore, but once open the vault key sits in script memory as it does after any unlock.
- Web Crypto exists only in secure contexts, so a server reached over plain HTTP (other
  than localhost) cannot use the vault; the forms say so.
- Additive for compatibility (ADR 0013): new routes, shapes and tables, and no change to
  an existing request or shape, so the protocol version stays. An older client sees a vault
  file as an attachment of a note it does not have and ignores it. A device follows the
  vault's shapes only once it has seen a vault or the user asks for one, so against an older
  server, which has no such shapes, the lock button keeps looking for a vault and the rest of
  the app is unaffected.
- Backups need no change (ADR 0012): the new tables are dumped and restored like any other.

Vault history (ADR 0022) derives separate per-note/per-epoch encryption and identity keys.
Compressed snapshots/deltas, drafts and cached versions are sealed before persistence or
upload; the server sees sizes, timing and equality within one note's epoch. Lock waits for
pending sealing and durable history jobs, then stops workers and clears session plaintext.
The server can keep an opaque original note ciphertext as a preimage for a legacy write;
an unlocked device opens it with the original note context. Restoring content online merges
it with the authoritative current settings on the device before sealing the live note again.
